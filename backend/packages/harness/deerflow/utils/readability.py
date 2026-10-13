import logging
import re
import shutil
import subprocess
from html import escape, unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse, urlsplit, uses_relative

import readabilipy
from bs4 import BeautifulSoup
from markdownify import markdownify as md
from readabilipy import simple_json_from_html_string

logger = logging.getLogger(__name__)


class Article:
    url: str

    def __init__(self, title: str, html_content: str):
        self.title = title
        self.html_content = html_content

    def to_markdown(self, including_title: bool = True) -> str:
        markdown = ""
        if including_title:
            markdown += f"# {self.title}\n\n"

        if self.html_content is None or not str(self.html_content).strip():
            markdown += "*No content available*\n"
        else:
            markdown += md(self.html_content)

        return markdown

    def to_message(self) -> list[dict]:
        image_pattern = r"!\[.*?\]\((.*?)\)"

        content: list[dict[str, str]] = []
        markdown = self.to_markdown()

        if not markdown or not markdown.strip():
            return [{"type": "text", "text": "No content available"}]

        parts = re.split(image_pattern, markdown)

        for i, part in enumerate(parts):
            if i % 2 == 1:
                image_url = urljoin(self.url, part.strip())
                content.append({"type": "image_url", "image_url": {"url": image_url}})
            else:
                text_part = part.strip()
                if text_part:
                    content.append({"type": "text", "text": text_part})

        # If after processing all parts, content is still empty, provide a fallback message.
        if not content:
            content = [{"type": "text", "text": "No content available"}]

        return content


_BASE_TAG_RE = re.compile(r"<base", re.IGNORECASE)
_PYTHON_FALLBACK_REMOVE_TAGS = (
    "script",
    "style",
    "noscript",
    "iframe",
    "object",
    "embed",
    "svg",
    "canvas",
    "form",
    "button",
    "input",
    "select",
    "textarea",
    "nav",
    "footer",
    "aside",
    "head",
    "base",
    "meta",
    "link",
)


def _is_safe_fallback_url(value: str, *, image: bool) -> bool:
    """Keep useful article links while dropping executable URL schemes."""
    try:
        parsed = urlsplit(value.strip())
    except ValueError:
        return False

    allowed_schemes = {"", "http", "https"} if image else {"", "http", "https", "ftp", "mailto"}
    scheme = parsed.scheme.lower()
    if scheme not in allowed_schemes:
        return False
    if scheme in {"http", "https", "ftp"} and not parsed.netloc:
        return False
    return bool(value.strip())


def _python_fallback_content(html: str, fallback_html: str | None) -> str:
    """Extract a readable subtree without losing anchor and image destinations.

    readabilipy's pure-Python tree builder reduces links to plain text. That is
    safe, but it makes citations and references unusable when Node is absent.
    Prefer the largest article/main subtree and keep only Markdown-relevant,
    safe attributes before handing the HTML to markdownify.
    """
    source = BeautifulSoup(html, "html.parser")
    candidates = source.find_all(["article", "main"])
    if candidates:
        content = max(candidates, key=lambda node: len(node.get_text(" ", strip=True)))
    elif fallback_html and fallback_html.strip():
        # Keep the dependency's text-oriented extraction for pages without an
        # article/main landmark, then restore link targets by their visible text.
        content = BeautifulSoup(fallback_html, "html.parser")
        for anchor in source.find_all("a", href=True):
            label = anchor.get_text(" ", strip=True)
            href = str(anchor.get("href", "")).strip()
            if not label or not _is_safe_fallback_url(href, image=False):
                continue
            for text_node in content.find_all(string=True):
                if str(text_node).strip() != label or text_node.parent.name == "a":
                    continue
                replacement = content.new_tag("a", href=href)
                replacement.string = str(text_node)
                text_node.replace_with(replacement)
                break
    else:
        content = source.body or source

    for element in content.find_all(_PYTHON_FALLBACK_REMOVE_TAGS):
        element.decompose()

    allowed_attributes = {
        "a": {"href", "title"},
        "img": {"src", "alt", "title"},
        "td": {"colspan", "rowspan"},
        "th": {"colspan", "rowspan"},
        "ol": {"start"},
        "li": {"value"},
    }
    for element in content.find_all(True):
        allowed = allowed_attributes.get(element.name, set())
        for name in list(element.attrs):
            if name not in allowed:
                del element.attrs[name]
                continue
            if name == "href" and not _is_safe_fallback_url(str(element.attrs[name]), image=False):
                del element.attrs[name]
            elif name == "src" and not _is_safe_fallback_url(str(element.attrs[name]), image=True):
                del element.attrs[name]

    return content.decode_contents() if isinstance(content, BeautifulSoup) else str(content)


def _resolve_html_urls(html: str, url: str) -> str:
    """Resolve destinations before extraction can discard the document's base tag."""
    # A base element requires a literal start-tag prefix. False positives in
    # comments or text elements still go through HTML5 tree construction.
    base = BeautifulSoup(html, "html5lib").find("base", href=True) if _BASE_TAG_RE.search(html) else None
    base_url = url
    if base is not None:
        try:
            candidate = urljoin(url, str(base["href"]).strip())
            # Keep only bases urljoin can resolve relative paths against.
            # Opaque bases fall back to the fetched URL; hierarchical FTP remains valid.
            if urlparse(candidate).scheme in uses_relative:
                base_url = candidate
        except ValueError:
            pass  # An invalid base must not prevent extraction of the page.
    resolver = _DestinationRewriter(html, base_url)
    resolver.feed(html)
    resolver.close()
    return resolver.result()


# Tokenize attributes only inside a start tag identified by HTMLParser. Keeping
# source spans avoids rebuilding malformed markup before jsdom parses it.
_ATTRIBUTE_RE = re.compile(r"""([^\s/>=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]*))?""")


class _DestinationRewriter(HTMLParser):
    # Treat link examples inside text-only elements as data, including nested
    # script-looking text; only the matching closing tag resumes tokenization.
    CDATA_CONTENT_ELEMENTS = ("script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext")

    def __init__(self, html: str, base_url: str):
        super().__init__(convert_charrefs=False)
        self.html = html
        self.base_url = base_url
        self.text_element: str | None = None
        self.line_offsets = [0, *(match.end() for match in re.finditer("\n", html))]
        self.replacements: list[tuple[int, int, str]] = []

    def handle_starttag(self, tag, attrs):
        if self.text_element is not None:
            return
        if tag in {"textarea", "title", "xmp", "iframe", "noembed", "noframes", "plaintext"}:
            self.text_element = tag
            return
        attribute = {"a": "href", "img": "src"}.get(tag)
        if attribute is None:
            return
        raw = self.get_starttag_text()
        tag_end = re.match(r"<[^\s/>]+", raw).end()
        for match in _ATTRIBUTE_RE.finditer(raw, tag_end):
            if match.group(1).lower() != attribute:
                continue
            value = match.group(2)
            if value is not None:
                original = unescape(value[1:-1] if value.startswith(('"', "'")) else value)
                try:
                    resolved = urljoin(self.base_url, original.strip())
                except ValueError:
                    return
                if resolved != original:
                    line, column = self.getpos()
                    offset = self.line_offsets[line - 1] + column
                    self.replacements.append((offset + match.start(2), offset + match.end(2), '"' + escape(resolved, quote=True) + '"'))
            else:
                line, column = self.getpos()
                offset = self.line_offsets[line - 1] + column + match.end(1)
                self.replacements.append((offset, offset, '="' + escape(self.base_url, quote=True) + '"'))
            # Browsers use the first duplicate attribute, including a bare one.
            return

    def handle_endtag(self, tag):
        if tag == self.text_element and tag != "plaintext":
            self.text_element = None

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def result(self) -> str:
        parts = []
        cursor = 0
        for start, end, value in self.replacements:
            parts.extend((self.html[cursor:start], value))
            cursor = end
        parts.append(self.html[cursor:])
        return "".join(parts)


class ReadabilityExtractor:
    def extract_article(self, html: str, *, url: str | None = None) -> Article:
        if url:
            html = _resolve_html_urls(html, url)
        python_fallback = False
        try:
            article = simple_json_from_html_string(html, use_readability=True)
            javascript_dir = Path(readabilipy.__file__).parent / "javascript"
            python_fallback = not (shutil.which("node") and (javascript_dir / "node_modules").is_dir())
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            stderr = getattr(exc, "stderr", None)
            if isinstance(stderr, bytes):
                stderr = stderr.decode(errors="replace")
            stderr_info = f"; stderr={stderr.strip()}" if isinstance(stderr, str) and stderr.strip() else ""
            logger.warning(
                "Readability.js extraction failed with %s%s; falling back to pure-Python extraction",
                type(exc).__name__,
                stderr_info,
                exc_info=True,
            )
            article = simple_json_from_html_string(html, use_readability=False)
            python_fallback = True

        if python_fallback:
            article["content"] = _python_fallback_content(html, article.get("content"))

        html_content = article.get("content")
        if not html_content or not str(html_content).strip():
            html_content = "No content could be extracted from this page"

        title = article.get("title")
        if not title or not str(title).strip():
            title = "Untitled"

        return Article(title=title, html_content=html_content)

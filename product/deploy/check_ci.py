#!/usr/bin/env python3
"""Wait for the exact deployment commit's existing GitHub push checks."""

import json
import os
import time
import urllib.request

REQUIRED = {"Lint Check", "Unit Tests", "Frontend Unit Tests"}
OPTIONAL = {"Backend Blocking IO", "Replay E2E (front-back contract)", "E2E Tests", "Skill Quality Review"}


def verdict(runs):
    latest = {}
    for run in sorted(runs, key=lambda item: (item["run_number"], item.get("run_attempt", 1)), reverse=True):
        if run["event"] == "push" and run["name"] in REQUIRED | OPTIONAL:
            latest.setdefault(run["name"], run)
    for name, run in latest.items():
        if run["status"] == "completed" and run["conclusion"] != "success":
            raise RuntimeError(f"{name}: {run['conclusion']}; automatic release blocked")
    return REQUIRED <= latest.keys() and all(run["status"] == "completed" for run in latest.values())


def main():
    repo = os.environ["GITHUB_REPOSITORY"]
    sha = os.environ["RELEASE_SHA"]
    base = f"https://api.github.com/repos/{repo}"
    headers = {"Authorization": "Bearer " + os.environ["GH_TOKEN"], "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    def get(path):
        with urllib.request.urlopen(urllib.request.Request(base + path, headers=headers), timeout=30) as response:
            return json.load(response)
    if get("/git/ref/heads/main")["object"]["sha"] != sha:
        raise RuntimeError("This commit is no longer main; release blocked")
    for attempt in range(360):
        if get("/git/ref/heads/main")["object"]["sha"] != sha:
            raise RuntimeError("Main advanced while waiting for CI; release blocked")
        runs = get(f"/actions/runs?head_sha={sha}&per_page=100")["workflow_runs"]
        if verdict(runs):
            print("Existing push checks passed for", sha)
            return
        print("Waiting for existing push checks", flush=True)
        time.sleep(10)
    raise RuntimeError("Required checks did not pass within 60 minutes")


if __name__ == "__main__":
    main()

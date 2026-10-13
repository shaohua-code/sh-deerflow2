"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { Locale } from "@/core/i18n/locale";
import { getBrandName } from "@/product/brand";
import { getProductCopy } from "@/product/copy";

export type MobileNavLink = {
  href: string;
  label: string;
};

export function MobileNav({
  links,
  locale,
}: {
  links: MobileNavLink[];
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const copy = getProductCopy(locale);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild className="sm:hidden">
        <Button variant="ghost" size="icon" aria-label={copy.openMenu}>
          <MenuIcon className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-64">
        <SheetHeader>
          <SheetTitle className="font-serif text-xl">
            {getBrandName(locale)}
          </SheetTitle>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-4 text-base font-medium">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="text-secondary-foreground hover:text-foreground rounded-md py-2 transition-colors"
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-3 border-t pt-3">
            <LocaleSwitcher locale={locale} />
          </div>
        </nav>
      </SheetContent>
    </Sheet>
  );
}

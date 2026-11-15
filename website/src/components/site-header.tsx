import { Link } from "@tanstack/react-router";
import { Menu, Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/lib/site";

const MOBILE_MENU_ID = "site-mobile-menu";

const navLinkClass = "text-sm text-brand-muted transition-colors hover:text-brand-text";
const activeNavLinkClass = "text-brand-text";

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2 font-mono text-lg font-semibold text-brand-text">
      <span aria-hidden="true" className="text-brand-accent">
        {">_"}
      </span>
      <span>
        rowbly
        <span aria-hidden="true" className="cursor-blink text-brand-accent">
          _
        </span>
      </span>
    </Link>
  );
}

function GitHubLink({ onClick }: Readonly<{ onClick?: () => void }>) {
  return (
    <a
      href={GITHUB_URL}
      className={`inline-flex items-center gap-1.5 ${navLinkClass}`}
      target="_blank"
      rel="noreferrer"
      onClick={onClick}
    >
      <Star aria-hidden="true" className="size-4" />
      GitHub
    </a>
  );
}

export function SiteHeader() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen]);

  function closeMenu() {
    setIsMenuOpen(false);
  }

  return (
    <header className="border-b border-brand-border bg-brand-background">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Wordmark />
        <nav aria-label="Main" className="hidden items-center gap-6 md:flex">
          <Link to="/how-it-works" className={navLinkClass} activeProps={{ className: activeNavLinkClass }}>
            How it works
          </Link>
          <Link to="/install" className={navLinkClass} activeProps={{ className: activeNavLinkClass }}>
            Install
          </Link>
          <GitHubLink />
        </nav>
        <Button
          ref={menuButtonRef}
          type="button"
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-expanded={isMenuOpen}
          aria-controls={MOBILE_MENU_ID}
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          {isMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </Button>
      </div>
      <nav
        id={MOBILE_MENU_ID}
        aria-label="Mobile"
        hidden={!isMenuOpen}
        className="border-t border-brand-border px-4 py-4 sm:px-6 md:hidden"
      >
        <ul className="flex flex-col gap-4">
          <li>
            <Link to="/how-it-works" className={navLinkClass} onClick={closeMenu}>
              How it works
            </Link>
          </li>
          <li>
            <Link to="/install" className={navLinkClass} onClick={closeMenu}>
              Install
            </Link>
          </li>
          <li>
            <GitHubLink onClick={closeMenu} />
          </li>
        </ul>
      </nav>
    </header>
  );
}

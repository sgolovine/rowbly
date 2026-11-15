import { DOCS_URL, GITHUB_URL, LICENSE_URL, NPM_URL } from "@/lib/site";

const footerLinks = [
  { label: "GitHub", href: GITHUB_URL },
  { label: "npm", href: NPM_URL },
  { label: "Docs", href: DOCS_URL },
  { label: "MIT License", href: LICENSE_URL },
] as const;

export function SiteFooter() {
  return (
    <footer className="border-t border-brand-border bg-brand-background">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="font-mono text-sm text-brand-muted">Free and open source under MIT.</p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {footerLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-brand-muted transition-colors hover:text-brand-text"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

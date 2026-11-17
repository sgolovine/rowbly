import { GITHUB_URL, LICENSE_URL, NPM_URL, SITE_URL } from "@/lib/site";

/** The title of the home page. */
export const HOME_TITLE = "Rowbly: a Kanban board in your repo, worked by Pi agents";

/** The description of the home page. The JSON-LD of the home page also uses it. */
export const HOME_DESCRIPTION =
  "Rowbly keeps a Kanban board of Stories as files in your Git repo. Each Stage has a prompt. A daemon runs Pi agents on the Stories, one worktree per worker. Open source, MIT.";

/** The absolute URL of the social card image (`public/images/og-image.png`). */
export const OG_IMAGE_URL = `${SITE_URL}/images/og-image.png`;

const OG_IMAGE_WIDTH = "1200";
const OG_IMAGE_HEIGHT = "630";
const OG_IMAGE_ALT =
  "The rowbly_ wordmark, the text 'Your backlog, built by a factory of agents.' and the Rowbly board";

type PageHeadInput = {
  /** The path of the page, for example `/` or `/install`. */
  readonly path: string;
  readonly title: string;
  readonly description: string;
};

/** Gives the absolute URL of a page on the site. The home URL ends in `/`. Other URLs have no trailing slash. */
export function pageUrl(path: string): string {
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

/**
 * Gives the `meta` and `links` of the route `head` for a page that search engines index: the title, the
 * description, the canonical URL, the Open Graph tags and the Twitter card tags.
 */
export function pageHead({ path, title, description }: PageHeadInput) {
  const url = pageUrl(path);
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Rowbly" },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:image", content: OG_IMAGE_URL },
      { property: "og:image:width", content: OG_IMAGE_WIDTH },
      { property: "og:image:height", content: OG_IMAGE_HEIGHT },
      { property: "og:image:alt", content: OG_IMAGE_ALT },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: OG_IMAGE_URL },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

/** Gives the `SoftwareApplication` JSON-LD of the home page as a script of the route `head`. */
export function softwareApplicationScript() {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Rowbly",
    url: SITE_URL,
    description: HOME_DESCRIPTION,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Linux",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    license: LICENSE_URL,
    downloadUrl: NPM_URL,
    codeRepository: GITHUB_URL,
    sameAs: [GITHUB_URL],
    image: OG_IMAGE_URL,
  };
  return { type: "application/ld+json", children: JSON.stringify(data) };
}

export default function PrivacyPolicy() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-sm text-foreground">
      <h1 className="mb-2 text-2xl font-bold">Privacy Policy</h1>
      <p className="mb-8 text-muted-foreground">LinkedIn Agent Chrome Extension — Last updated July 2026</p>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">What data the extension accesses</h2>
        <p className="text-muted-foreground">
          The LinkedIn Agent extension reads publicly visible profile information (name, headline, company, about
          section) and post commenter data from LinkedIn pages you visit. This data is sent to the XDR Hub
          server to generate outreach drafts and track prospect pipeline.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">What data is stored</h2>
        <p className="text-muted-foreground">
          Profile and prospect data is stored in the XDR Hub workspace database, accessible only to
          authenticated members of your Builder.io organization. No data is sold or shared with third parties.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Authentication</h2>
        <p className="text-muted-foreground">
          The extension uses a personal API token to identify requests. This token is stored locally in
          Chrome storage and is never transmitted to any third party.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Third-party services</h2>
        <p className="text-muted-foreground">
          The extension communicates only with <strong>xdr-hub.netlify.app</strong>. No analytics, tracking
          scripts, or advertising services are included.
        </p>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Data retention and deletion</h2>
        <p className="text-muted-foreground">
          Prospect data can be deleted at any time from within the LinkedIn Agent app. To request full data
          deletion, contact your workspace admin.
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Contact</h2>
        <p className="text-muted-foreground">
          Questions? Email <a href="mailto:fred@builder.io" className="underline">fred@builder.io</a>.
        </p>
      </section>
    </main>
  );
}

/** Shown inside the portal while a page's file downloads (sidebar and header stay visible). */
export default function PageLoader() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-48 rounded-lg bg-gray-200" />
      <div className="h-4 w-72 max-w-full rounded bg-gray-100" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
        {[0, 1, 2, 3].map(i => <div key={i} className="h-20 rounded-2xl bg-white border border-gray-100" />)}
      </div>
      <div className="h-48 rounded-2xl bg-white border border-gray-100" />
    </div>
  );
}

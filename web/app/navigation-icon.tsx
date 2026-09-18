const paths: Record<string, string> = {
  overview: "m3 10 9-7 9 7v10h-6v-6H9v6H3Z",
  workspace: "m3 7 9-4 9 4-9 4Zm0 5 9 4 9-4M3 17l9 4 9-4",
  feature: "M5 3h14v18H5ZM8 7h8M8 11h8M8 15h5",
  graph: "M4 4h5v5H4Zm11 11h5v5h-5ZM9 6h8v9M6 9v8h9",
  impact: "M6 3v18m0-18-3 3m3-3 3 3M18 21V3m0 18-3-3m3 3 3-3M9 10h6m-6 4h6",
  settings: "m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3ZM9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
};
export function NavigationIcon({ name }: { name: string }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name] ?? paths.graph} /></svg>;
}

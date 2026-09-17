// A dedicated loopback frontend lets fixture runs coexist with a local deployment.
export function browserOrigin(value = process.env.F001_TEST_WEB_ORIGIN) {
  if (!value) throw new Error("F001 browser fixture requires a dedicated loopback Web origin");
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)
      || url.port !== "3190"
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("F001 browser fixture requires a dedicated loopback Web origin");
  }
  return url.origin;
}

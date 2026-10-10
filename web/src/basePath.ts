// The server rewrites index.html's <base href> to the URL prefix the app is
// mounted under (e.g. "/sweep/" behind the reverse proxy; "/" otherwise).
// basePath is that prefix without a trailing slash: "" or "/sweep".
export const basePath = new URL(document.baseURI).pathname.replace(/\/+$/, '')

/** Prefix an absolute app path ("/api/events") with basePath. */
export const withBase = (path: string) => basePath + path

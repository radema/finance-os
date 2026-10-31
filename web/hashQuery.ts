/** The query part of the URL hash: `#/setup/products?name=BTP` gives `name=BTP`. */
export const hashParams = (): URLSearchParams =>
  new URLSearchParams(
    typeof window === "undefined" ? "" : (window.location.hash.split("?")[1] ?? ""),
  );

// Vite turns `?url` imports into the public URL of the bundled file.
declare module "*?url" {
  const url: string;
  export default url;
}

// The game's files are bundled into the Worker as raw data.
declare module '*.bin' {
  const data: ArrayBuffer;
  export default data;
}

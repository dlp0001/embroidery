declare module '@/server/legacy/*.js' {
  const handler: (req: unknown, res: unknown) => unknown;
  export default handler;
}

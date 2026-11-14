// docs/dsl.md is imported as text (with { type: "text" }) by src/man.ts
declare module "*.md" {
  const text: string;
  export default text;
}

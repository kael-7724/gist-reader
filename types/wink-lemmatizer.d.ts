declare module "wink-lemmatizer" {
  const lemmatizer: {
    adjective(word: string): string;
    noun(word: string): string;
    verb(word: string): string;
  };

  export default lemmatizer;
}

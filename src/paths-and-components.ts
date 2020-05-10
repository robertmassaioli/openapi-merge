import { MergeInput, ErrorMergeResult } from "./data";
import { Swagger } from "atlassian-openapi";

export type PathAndComponents = {
  paths: Swagger.Paths;
  components: Swagger.Components;
};

export function mergePathsAndComponents(inputs: MergeInput): PathAndComponents | ErrorMergeResult {
  // For each component in the original input, place it in the output with deduplicate taking place

  // For each path, convert it into the right format (looking out for duplicates)
  return { paths: {}, components: {} };
}
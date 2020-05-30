import { MergeInput } from './data';
import { Swagger } from 'atlassian-openapi';

function getNonExcludedTags(originalTags: Swagger.Tag[], excludedTagNames: string[] | undefined): Swagger.Tag[] {
  if (excludedTagNames === undefined) {
    return originalTags;
  }

  return originalTags.filter(tag => !excludedTagNames.includes(tag.name));
}

export function mergeTags(inputs: MergeInput): Swagger.Tag[] | undefined {
  const result = new Array<Swagger.Tag>();

  const seenTags = new Set<string>();
  inputs.forEach(input => {
    const { excludePathsTaggedWith } = input;
    const { tags } = input.oas;
    if (tags !== undefined) {
      const nonExcludedTags = getNonExcludedTags(tags, excludePathsTaggedWith);

      nonExcludedTags.forEach(tag => {
        if (!seenTags.has(tag.name)) {
          seenTags.add(tag.name);
          result.push(tag);
        }
      });
    }
  });

  if (result.length === 0) {
    return undefined;
  }

  return result;
}
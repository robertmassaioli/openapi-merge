import { MergeInput } from './data';
import { Swagger } from 'atlassian-openapi';

function getNonExcludedTags(originalTags: Swagger.Tag[], excludedTagNames: string[]): Swagger.Tag[] {
  if (excludedTagNames.length === 0) {
    return originalTags;
  }

  return originalTags.filter(tag => !excludedTagNames.includes(tag.name));
}

export function mergeTags(inputs: MergeInput): Swagger.Tag[] | undefined {
  const result = new Array<Swagger.Tag>();

  const seenTags = new Set<string>();
  inputs.forEach(input => {
    const { operationSelection } = input;
    const { tags } = input.oas;
    if (tags !== undefined) {
      let excludeTags = operationSelection !== undefined && operationSelection.excludeTags !== undefined ? operationSelection.excludeTags : [];
      const nonExcludedTags = getNonExcludedTags(tags, excludeTags);

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
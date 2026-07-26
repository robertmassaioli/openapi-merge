import { MergeInput } from './data';
import { Tag32 } from './oas31';

function getNonExcludedTags(originalTags: Tag32[], excludedTagNames: string[]): Tag32[] {
  if (excludedTagNames.length === 0) {
    return originalTags;
  }

  return originalTags.filter(tag => !excludedTagNames.includes(tag.name));
}

export function mergeTags(inputs: MergeInput): Tag32[] | undefined {
  const result = new Array<Tag32>();

  const seenTags = new Set<string>();
  inputs.forEach(input => {
    const { operationSelection } = input;
    const { tags } = input.oas;
    if (tags !== undefined) {
      const excludeTags = operationSelection !== undefined && operationSelection.excludeTags !== undefined ? operationSelection.excludeTags : [];
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
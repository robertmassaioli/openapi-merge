import { MergeInput } from './data';
import { Tag32 } from './oas31';
import { TagMatcher } from './tag-matching';

function getNonExcludedTags(originalTags: Tag32[], excludedTagNames: string[]): Tag32[] {
  // The same matcher the operation filter uses, so a wildcard cannot remove the
  // operations while leaving their tag declarations behind in the output
  // (issue #111).
  const matcher = new TagMatcher(excludedTagNames);
  if (matcher.isEmpty) {
    return originalTags;
  }

  return originalTags.filter(tag => !matcher.matches(tag.name));
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
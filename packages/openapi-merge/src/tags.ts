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

    // An injected tag has to be declared as well as applied (issue #112).
    // Operations carrying a tag the document never declares is legal but
    // unhelpful: tooling that builds navigation from `tags` would show the
    // operations under a heading with no description, or not at all.
    //
    // Declared before this input's own tags so it reads as the grouping it is,
    // and first-wins if another input already contributed the same name.
    if (input.tag !== undefined && !seenTags.has(input.tag.name)) {
      seenTags.add(input.tag.name);
      result.push(
        input.tag.description === undefined
          ? { name: input.tag.name }
          : { name: input.tag.name, description: input.tag.description },
      );
    }

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
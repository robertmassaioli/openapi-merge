import { MergeInput } from './data';
import { Swagger } from 'atlassian-openapi';

export function mergeTags(inputs: MergeInput): Swagger.Tag[] | undefined {
  const result = new Array<Swagger.Tag>();

  const seenTags = new Set<string>();
  inputs.forEach(input => {
    const { tags } = input.oas;
    if (tags !== undefined) {
      tags.forEach(tag => {
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
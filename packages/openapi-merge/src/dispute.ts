import { Dispute, DisputePrefix, SingleMergeInput } from './data';

export function getDispute(input: SingleMergeInput): Dispute | undefined {
  if ('disputePrefix' in input) {
    if (input.disputePrefix !== undefined) {
      return {
        disputePrefix: input.disputePrefix
      };
    }

    return undefined;
  } else if ('dispute' in input) {
    return input.dispute;
  }

  return undefined;
}

export type DisputeStatus = 'disputed' | 'undisputed';

function isDisputePrefix(dispute: Dispute): dispute is DisputePrefix {
  return 'disputePrefix' in dispute;
}

export function applyDispute(dispute: Dispute | undefined, input: string, status: DisputeStatus): string {
  if (dispute === undefined) {
    return input;
  }

  if (status === 'disputed' || dispute.alwaysApply) {
    return isDisputePrefix(dispute) ? `${dispute.disputePrefix}${input}` : `${input}${dispute.disputeSuffix}`;
  }

  return input;
}
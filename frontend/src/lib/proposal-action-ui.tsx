import type { ProposalActionIconName } from './proposal-action-icons';
import type { ProposalActionBlockedReason, ProposalActionResolution } from './write-actions';

export type NavActionUi = {
  iconName: ProposalActionIconName;
  label: string;
};

export type SummaryActionUi = {
  iconName: ProposalActionIconName;
  iconClassName: string;
  borderStyle: string;
  title: string;
  buttonText: string | null;
};

type BaseCardActionUi = {
  title: string;
  description: string;
  readyText: string;
  actionLabel: string | null;
  statusIconName: ProposalActionIconName;
  statusIconClassName: string;
};

export type ProposalCardUi = Omit<BaseCardActionUi, 'actionLabel'> & {
  buttonLabel: string | null;
  buttonIconName: ProposalActionIconName | null;
  isButtonDisabled: boolean;
  showButton: boolean;
};

export type PageActionUi = {
  title: string;
  description: string;
  iconName: ProposalActionIconName;
  iconClassName: string;
  iconContainerClassName: string;
};

export type ProposalActionUi = {
  nav: NavActionUi;
  summary: SummaryActionUi;
  card: BaseCardActionUi;
  page: PageActionUi;
};

type ProposalActionUiKey =
  | 'propose'
  | 'execute'
  | 'executed'
  | 'invalid'
  | ProposalActionBlockedReason;

type ProposalActionButtonState = Pick<
  ProposalCardUi,
  'buttonLabel' | 'buttonIconName' | 'isButtonDisabled' | 'showButton'
>;

const PROPOSAL_ACTION_UI: Record<ProposalActionUiKey, ProposalActionUi> = {
  propose: {
    nav: { iconName: 'send', label: 'Propose' },
    summary: {
      iconName: 'send',
      iconClassName: 'h-5 w-5 text-primary',
      borderStyle: 'border-primary/20 bg-primary/5',
      title: 'Proposal Ready',
      buttonText: 'Review & Propose',
    },
    card: {
      title: 'Proposal calls',
      description: 'Calls included in this proposal.',
      readyText: 'Ready to propose',
      actionLabel: 'Propose',
      statusIconName: 'check',
      statusIconClassName: 'h-4 w-4 mr-2 text-green-500',
    },
    page: {
      title: 'Submit Proposal',
      description: 'Review the transaction parameters and submit this proposal on-chain.',
      iconName: 'send',
      iconClassName: 'h-6 w-6 text-primary',
      iconContainerClassName: 'bg-primary/10',
    },
  },
  execute: {
    nav: { iconName: 'play', label: 'Execute' },
    summary: {
      iconName: 'play',
      iconClassName: 'h-5 w-5 text-primary',
      borderStyle: 'border-orange-500/20 bg-orange-500/5',
      title: 'Ready to Execute',
      buttonText: 'Review & Execute',
    },
    card: {
      title: 'Proposal calls',
      description: 'Calls included in this proposal.',
      readyText: 'Ready to execute',
      actionLabel: 'Execute',
      statusIconName: 'check',
      statusIconClassName: 'h-4 w-4 mr-2 text-green-500',
    },
    page: {
      title: 'Execute Proposal',
      description: 'This proposal has passed voting and is ready to be executed.',
      iconName: 'play',
      iconClassName: 'h-6 w-6 text-orange-500',
      iconContainerClassName: 'bg-orange-500/10',
    },
  },
  executed: {
    nav: { iconName: 'check', label: 'Details' },
    summary: {
      iconName: 'check',
      iconClassName: 'h-5 w-5 text-green-500',
      borderStyle: 'border-green-500/20 bg-green-500/5',
      title: 'Already Executed',
      buttonText: 'View Details',
    },
    card: {
      title: 'Executed Proposal',
      description: 'This proposal has already been executed',
      readyText: 'Already executed',
      actionLabel: null,
      statusIconName: 'check',
      statusIconClassName: 'h-4 w-4 mr-2 text-gray-400',
    },
    page: {
      title: 'Proposal Details',
      description: 'This proposal has already been executed on-chain.',
      iconName: 'check',
      iconClassName: 'h-6 w-6 text-green-500',
      iconContainerClassName: 'bg-green-500/10',
    },
  },
  defeated: {
    nav: { iconName: 'x', label: 'Defeated' },
    summary: {
      iconName: 'x',
      iconClassName: 'h-5 w-5 text-red-500',
      borderStyle: 'border-red-500/20 bg-red-500/5',
      title: 'Proposal Defeated',
      buttonText: null,
    },
    card: {
      title: 'Proposal Defeated',
      description: 'This proposal can no longer be executed.',
      readyText: 'Proposal defeated',
      actionLabel: null,
      statusIconName: 'x',
      statusIconClassName: 'h-4 w-4 mr-2 text-red-500',
    },
    page: {
      title: 'Proposal Defeated',
      description: 'This proposal was defeated and can no longer be executed.',
      iconName: 'x',
      iconClassName: 'h-6 w-6 text-red-500',
      iconContainerClassName: 'bg-red-500/10',
    },
  },
  expired: {
    nav: { iconName: 'x', label: 'Expired' },
    summary: {
      iconName: 'x',
      iconClassName: 'h-5 w-5 text-gray-500',
      borderStyle: 'border-gray-500/20 bg-gray-500/5',
      title: 'Proposal Expired',
      buttonText: null,
    },
    card: {
      title: 'Proposal Expired',
      description: 'This proposal can no longer be executed.',
      readyText: 'Proposal expired',
      actionLabel: null,
      statusIconName: 'x',
      statusIconClassName: 'h-4 w-4 mr-2 text-gray-400',
    },
    page: {
      title: 'Proposal Expired',
      description: 'This proposal expired before execution and can no longer be executed.',
      iconName: 'x',
      iconClassName: 'h-6 w-6 text-gray-500',
      iconContainerClassName: 'bg-gray-500/10',
    },
  },
  canceled: {
    nav: { iconName: 'x', label: 'Canceled' },
    summary: {
      iconName: 'x',
      iconClassName: 'h-5 w-5 text-gray-500',
      borderStyle: 'border-gray-500/20 bg-gray-500/5',
      title: 'Proposal Canceled',
      buttonText: null,
    },
    card: {
      title: 'Proposal Canceled',
      description: 'This proposal can no longer be executed.',
      readyText: 'Proposal canceled',
      actionLabel: null,
      statusIconName: 'x',
      statusIconClassName: 'h-4 w-4 mr-2 text-gray-400',
    },
    page: {
      title: 'Proposal Canceled',
      description: 'This proposal was canceled and can no longer be executed.',
      iconName: 'x',
      iconClassName: 'h-6 w-6 text-gray-500',
      iconContainerClassName: 'bg-gray-500/10',
    },
  },
  unknown: {
    nav: { iconName: 'clock', label: 'Unavailable' },
    summary: {
      iconName: 'clock',
      iconClassName: 'h-5 w-5 text-gray-500',
      borderStyle: 'border-gray-500/20 bg-gray-500/5',
      title: 'Proposal Not Executable',
      buttonText: null,
    },
    card: {
      title: 'Proposal Not Executable',
      description: 'This proposal is not currently executable.',
      readyText: 'Not executable',
      actionLabel: null,
      statusIconName: 'clock',
      statusIconClassName: 'h-4 w-4 mr-2 text-gray-400',
    },
    page: {
      title: 'Proposal Not Executable',
      description: 'This proposal cannot be executed from this report.',
      iconName: 'clock',
      iconClassName: 'h-6 w-6 text-gray-500',
      iconContainerClassName: 'bg-gray-500/10',
    },
  },
  invalid: {
    nav: { iconName: 'clock', label: 'Unavailable' },
    summary: {
      iconName: 'x',
      iconClassName: 'h-5 w-5 text-gray-500',
      borderStyle: 'border-gray-500/20 bg-gray-500/5',
      title: 'Action Unavailable',
      buttonText: null,
    },
    card: {
      title: 'Invalid Proposal Metadata',
      description: 'This report cannot be used for execution.',
      readyText: 'Action unavailable',
      actionLabel: null,
      statusIconName: 'x',
      statusIconClassName: 'h-4 w-4 mr-2 text-gray-400',
    },
    page: {
      title: 'Proposal Not Executable',
      description: 'This proposal cannot be executed from this report.',
      iconName: 'clock',
      iconClassName: 'h-6 w-6 text-gray-500',
      iconContainerClassName: 'bg-gray-500/10',
    },
  },
};

function getProposalActionUiKey(action: ProposalActionResolution): ProposalActionUiKey {
  return action.kind === 'blocked' ? action.reason : action.kind;
}

function toProposalCardUi(
  card: BaseCardActionUi,
  button: ProposalActionButtonState,
): ProposalCardUi {
  return {
    title: card.title,
    description: card.description,
    readyText: card.readyText,
    statusIconName: card.statusIconName,
    statusIconClassName: card.statusIconClassName,
    ...button,
  };
}

export function getProposalActionUi(action: ProposalActionResolution): ProposalActionUi {
  return PROPOSAL_ACTION_UI[getProposalActionUiKey(action)];
}

export function getProposalCardUi(
  action: ProposalActionResolution,
  options: {
    isConnected: boolean;
    isPending: boolean;
    isPendingConfirmation: boolean;
  },
): ProposalCardUi {
  const card = getProposalActionUi(action).card;

  if (!card.actionLabel) {
    return toProposalCardUi(card, {
      buttonLabel: null,
      buttonIconName: null,
      isButtonDisabled: true,
      showButton: false,
    });
  }

  if (!options.isConnected) {
    return toProposalCardUi(card, {
      buttonLabel: 'Connect Wallet',
      buttonIconName: null,
      isButtonDisabled: true,
      showButton: true,
    });
  }

  if (options.isPendingConfirmation) {
    return toProposalCardUi(card, {
      buttonLabel: 'Confirming...',
      buttonIconName: null,
      isButtonDisabled: true,
      showButton: true,
    });
  }

  if (options.isPending) {
    return toProposalCardUi(card, {
      buttonLabel: action.kind === 'propose' ? 'Creating...' : 'Executing...',
      buttonIconName: null,
      isButtonDisabled: true,
      showButton: true,
    });
  }

  return toProposalCardUi(card, {
    buttonLabel: card.actionLabel,
    buttonIconName: action.kind === 'propose' ? 'send' : 'play',
    isButtonDisabled: false,
    showButton: true,
  });
}

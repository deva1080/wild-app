import { Address } from 'viem';
import { addresses } from './addresses';

export type PaymentMethodKey = 'WILD' | 'USDC' | 'CREDITS' | 'FUN';

export interface PaymentMethod {
  key: PaymentMethodKey;
  /** Short label shown in the UI. */
  label: string;
  /** Token symbol used in result/balance strings. */
  symbol: string;
  /** Token contract whose balance backs this method (settle token for credits). */
  address: Address;
  /** ERC20 decimals for parsing/formatting bet amounts. */
  decimals: number;
  /** Whether the bet is paid from Game Credits instead of a token transfer. */
  useCredits: boolean;
  /** Whether this is the local, no-wallet demo balance. */
  isFun?: boolean;
}

export const PAYMENT_METHODS: Record<PaymentMethodKey, PaymentMethod> = {
  WILD: {
    key: 'WILD',
    label: 'WILD',
    symbol: 'WILD',
    address: addresses.wildToken,
    decimals: 18,
    useCredits: false,
  },
  USDC: {
    key: 'USDC',
    label: 'USDC',
    symbol: 'USDC',
    address: addresses.usdc,
    decimals: 6,
    useCredits: false,
  },
  CREDITS: {
    key: 'CREDITS',
    label: 'Credits',
    symbol: 'CRED',
    // Credits settle in the WILD token on-chain.
    address: addresses.wildToken,
    decimals: 18,
    useCredits: true,
  },
  FUN: {
    key: 'FUN',
    label: 'FUN Play',
    symbol: 'FUN',
    // Preview calls use WILD's configured bet limits, but never move funds.
    address: addresses.wildToken,
    decimals: 18,
    useCredits: false,
    isFun: true,
  },
};

export const PAYMENT_METHOD_LIST: PaymentMethod[] = [
  PAYMENT_METHODS.WILD,
  PAYMENT_METHODS.USDC,
  PAYMENT_METHODS.CREDITS,
  PAYMENT_METHODS.FUN,
];

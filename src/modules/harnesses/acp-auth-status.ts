import type { AcpAuthStatus } from "./acp-client";

export type AcpAuthStatusSummary = {
  label: string;
  value: string;
  detailLabel: string | null;
  detail: string | null;
  signedIn: boolean;
};

function clean(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/**
 * Turn the adapter's auth identity into two compact settings rows. Identity
 * details are display-only; credentials stay on the bridge host.
 */
export function summarizeAcpAuthStatus(
  status: AcpAuthStatus | null | undefined,
): AcpAuthStatusSummary | null {
  if (!status) return null;
  const value = clean(status.label) ?? status.kind;
  const email = clean(status.account?.email);
  const organization = clean(status.account?.organization);
  const detail = clean(status.detail);

  if (status.kind === "account") {
    return {
      label: "Plan",
      value,
      detailLabel:
        email || organization ? "Signed in as" : null,
      detail: email ?? organization,
      signedIn: true,
    };
  }

  if (status.kind === "none") {
    return {
      label: "Authentication",
      value: value || "Not signed in",
      detailLabel: null,
      detail: null,
      signedIn: false,
    };
  }

  return {
    label: "Authentication",
    value,
    detailLabel: detail ? "Source" : null,
    detail,
    signedIn: true,
  };
}

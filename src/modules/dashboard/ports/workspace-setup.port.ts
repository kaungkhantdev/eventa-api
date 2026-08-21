/**
 * What the dashboard needs to know about how far a workspace has been set up,
 * without reading another module's tables.
 *
 * Each fact is owned by the module that owns the decision (DIP): the dashboard
 * asks "is this done", it does not define what done means. That matters most
 * for the organization: "configured" is a statement about what a valid invoice
 * needs, and the organization module is where that belongs — a checklist in the
 * web app guessing at it would be a rule nobody could change safely.
 *
 * Every method is tenant-scoped by its argument, so the dashboard has no way to
 * ask about a workspace that is not the caller's.
 */

/** Whether the details that appear on every ticket and invoice are filled in. */
export abstract class OrganizationSetupPort {
  abstract isConfigured(organizationId: number): Promise<boolean>;
}

/** Whether this workspace could actually take money today. */
export abstract class PaymentSetupPort {
  abstract isConnected(organizationId: number): Promise<boolean>;
}

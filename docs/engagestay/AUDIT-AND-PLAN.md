# EngageStay access, Connect and billing — audit and implementation plan

Date: 6 November 2026. Development branch: `feature/engagestay-access-connect-billing` in both application repositories. No production deployment or database write is authorised by this brief. Database integration is local-only per the user's reply.

## Verified current state

| Area | Evidence and finding |
|---|---|
| Client | React 19/Vite 8, JavaScript/JSX, state-selected pages in App/PortfolioWorkspace; no router library. Working layouts must be extended rather than rebuilt. |
| Server | Express 5, PostgreSQL through `pg`; SQLite explicit local mode. Prisma contract files coexist with hand-written SQL/workspace persistence. |
| Identity | Integer application user IDs, scrypt password hashes, HttpOnly `friday_session` cookie and database session checks on every API request. This is not Supabase Auth. |
| Property access | Home property plus `friday_property_access`; role stored once on user, not per property. No organisation entity in the inspected application contract. |
| Permissions | Legacy role allowlists and whole-workspace writes. Workspace GET returns broad state. Action-level filtering and approval separation are missing. Broad state reads must be replaced/masked before granular RBAC can be claimed. |
| Connected Supabase | Only visible project is `trypyepdjmfjzofggduk`, named Engage stay - production. Metadata inspection only. It contains original PMS tables and owner administration tables, but not the current API's `friday_sessions`/workspace tables. Do not assume this is the actual deployed API database. |
| Platform roles | `owner_roles`, `owner_permissions`, `owner_role_permissions`, `owner_profiles` exist. Eight roles/20 permissions concern platform customers, deployments and infrastructure. They must not be repurposed as hotel-customer roles or granted to hotel staff. |
| Critical RLS finding | `callLog`, `guest`, `payment`, `property`, `reservation`, `room`, `roomType`, `serviceRequest`, `teleCMIUserMapping`, `user` have RLS disabled and broad anon/authenticated grants. Only an owner_profiles self-SELECT policy was found. No remediation executed: switching RLS on without an identity/access design could break access. |
| Migrations | No Supabase migration history returned. Prisma contract snapshots exist; hand-written app SQL also exists. Establish one reviewed migration ledger for the new feature set. |
| Subscription | Owner API returns Not configured; client shows a hardcoded Enterprise draft. No actual Basic/Premium/Enterprise customer subscription records, pricing or entitlement enforcement in this branch. |
| Communication | Local guest communication drafts, TeleCMI integration paths and task records exist; no internal channel/member/message system. |
| Realtime/storage | Realtime publication exists in connected project; no attachment buckets returned. Existing application sessions cannot simply be used as Supabase Auth JWTs. |
| Language | English/Kannada implementation exists on `origin/feature/user-language-preferences`, not current main. Preserve/reconcile this work rather than introduce another preference system. Its production migration remains unapproved. |
| Visual system | Existing Inter/Arial typography, blue/cyan identity, shared design tokens and compact responsive layouts. Reuse these for new screens. |
| Deployment | Client `/api` rewrite targets the deployed Friday server. Development branches must not be promoted to production. |

## Business specifications obtained

The user supplied the full 20-module/five-role matrix in this chat after the audit began. The original attached master prompt provides the separate subscription role rules and Connect entitlement. Earlier chats supply role descriptions, but not an additional authoritative complete matrix. Commercial prices/limits will be supplied later. Do not import suggested/example commercial allocations from previous assistant messages.

Permission labels require safe action semantics: Full Access is all applicable non-approval actions; Create & Edit is view/create/update; View Only is view; Approval Access is approve independently; No Access is no grants. Restricted Access requires explicit resource/field/threshold policies and denies by default until those exist. This conservative interpretation is recorded for review; it must never become an implicit unrestricted grant.

## Architecture and integration order

1. Preserve the supplied matrix verbatim in structured source with stable feature keys, module grouping, labels and role descriptions. Record planned features without exposing working controls for them.
2. Introduce one server access decision service. Evaluate authenticated active user, active organisation membership, explicitly assigned property, matching role assignment, action grant/override, subscription and resource policy. A customer role never bypasses tenant scope. Explicit deny wins. Approval never grants transaction creation/update.
3. Add an additive data model using existing application identity/property IDs. Keep a separately verified Supabase Auth bridge for browser Realtime; never match identities solely by an unverified client email. Do not auto-map all legacy ADMIN accounts to Property Owner.
4. Use current database state on protected actions and membership changes. Realtime subscriptions require revocation-aware server validation and token/channel invalidation. Private DM participation must remain separate from administrative authority.
5. Replace broad workspace reads/writes with scoped DTOs/commands incrementally. Finance and guest fields must not leak through a generally readable dashboard response. Keep the new system gated off until each route is mapped and regression-tested.
6. Build Settings → Team & Permissions on the same service: searchable grouped matrix, custom roles, scoped assignments/overrides, change preview, audit and final-owner safeguards. Prevent delegating any grant the acting user cannot exercise/delegate.
7. Subscription records are organisation-level by default. Store approved customer plan, currency, price, dates, status, limits, invoices and entitlements. Unknown prices/limits remain null/unconfigured; never invent customer subscriptions. Only Connect's plan inclusion is specified so far. Upgrade/downgrade actions create requests, not active subscriptions or payments.
8. Connect uses persisted channels/members/messages, private storage, keyset pagination, idempotent send IDs and per-request permission checks. Default channels use unique organisation/property/type keys. Reuse tasks for escalations and share opaque PMS record references that recipients must authorise independently.
9. Reconcile the existing language branch, then localise new screens in English/Kannada. Test both languages, phone/tablet/desktop, keyboard, empty/loading/error/reconnect states.

## Local validation and release gates

- Use only local isolated test data until a staging project is explicitly provided. Existing production Supabase is audit-only.
- Test denial of cross-tenant/property access, unknown permissions, inactive memberships, role revocation, Basic chat access, expired/downgraded subscriptions, unauthorised exports/approvals and private DM access by administrators.
- Test local persistence/reload, duplicate send prevention, cursor pagination, attachment ownership/type/size, optimistic failure recovery and concurrent membership changes.
- Supabase Realtime, actual RLS and private Storage require a local Supabase/Postgres instance or staging environment. SQLite/pure unit tests cannot certify those integrations.
- No Docker, psql or Supabase CLI was found on the initial PATH inspection. Do not claim the integration layer is tested until its actual runtime is available.
- Before release: database identity/provisioning mapping reviewed; restricted policies supplied; commercial definitions imported; migrations/advisors/RLS tests passed; every protected route mapped; visual evidence captured; full regressions passed; explicit production approval obtained.

## Rollback approach

Keep existing identity and business records; add new structures without destructive rewrites. New routes stay gated until provisioned. Disable the feature gate to return to existing flows during development; never use that switch to bypass authorisation in an enabled production tenant. Revert application commits independently of retained chat/audit data. Production migration rollback must preserve records and be reviewed separately.

## Updated owner decisions — 6 November 2026

Restricted Access is denied by default; the Property Owner may explicitly grant scoped feature/action access to selected staff and assigned properties, and revoke it. This does not bypass tenant boundaries, subscription entitlements or private conversation membership. Owner grant/revoke persistence and UI are still pending integration.

Pricing is not required for this phase. The user authorises proposed plan designs for review. The local-only subscription review screen proposes Basic (1 branch / 50 rooms / 10 staff), Premium (5 / 500 / 50) and Enterprise (20 / 2,000 / 200), with editable allowances and no price fields. Connect remains excluded from Basic and included in Premium/Enterprise. Other package allocations are proposals, not approved runtime entitlements. Review drafts persist only in browser session storage; they are not active customer subscriptions or database billing records.

# Agent Note: Isolated interactive HTML preview

Status: implemented

English | [中文](2026-09-24-isolated-html-preview.zh.md)

## Problem

HTML reports can need local images, stylesheets, and classic JavaScript while retaining the source provider's version and read authority.

Enabling Coding Tools also enables unrelated capabilities, and an opaque scripted iframe alone does not prevent network requests.

CSP `connect-src 'none'` does not cover WebRTC, and a child document can navigate itself without accessing the parent origin.

## Decision

The existing [document preview plugin](../../../../packages/client/ui-sidebar-documentpreview/README.md#how-it-reads) owns `html.mode`, with `coding-tools` as the compatible default, `static` as an unconditional static policy, and `isolated-interactive` as a separate opt-in policy.

The isolated policy reuses the native HTML renderer and its original-address `workspaceFiles.readBytes` callback.

The finite resource package includes local classic JavaScript, self-contained CSS, and passive images; missing, external, oversized, or unsupported dependencies fail before publication.

CSS escapes and recursive resource constructs are conservatively rejected until a parser-backed recursive policy is required.

The Host serves a static bootstrap with an empty native `Connection-Allowlist` response policy and CSP, with no user content, resource proxy, query parameters, or reporting endpoint.

The opaque frame initially contains only trusted code.

It constructs and closes a WebRTC peer without ICE servers or an offer, then waits for a local enforcement report identifying an empty allowlist before the parent sends the packaged document.

This proves the effective browser policy rather than inferring support from a version, a JavaScript API name, or an exception.

The response policy survives document replacement and governs HTTP, WebRTC, and navigation, while CSP blocks descendant documents, Workers, forms, and unsupported resources.

The rendered document reports resource, script, promise, and policy failures; the parent binds messages to the current frame and mount token and removes failed content.

## Alternatives considered

**Use only a sandbox and CSP.** A synthetic loopback browser check demonstrates self-navigation and WebRTC escape paths despite `connect-src 'none'`.

**Remove network-related JavaScript globals.** New realms can restore them, so a JavaScript denylist cannot establish the required browser boundary.

**Use an iframe `connectionallowlist` attribute.** The tested browser implements the response header but does not enforce that attribute.

**Assume support from the user agent.** Rollout flags, older engines, and stripped response headers can differ from the advertised browser version.

**Add a separate renderer, resource server, or public policy registry.** The current Config and scoped file reader already provide the required extension points; a trusted static bootstrap adds no file authority.

## Consequences

Deployment must preserve the bootstrap response headers, and browsers without the positive enforcement report show an unsupported-preview message before receiving document bytes.

The local report has no configured network reporting destination.

File-based desktop loading cannot use this HTTP policy, and the preview does not bound script CPU or memory use.

The [browser regression](../../../../apps/web/tests/isolated-html-policy.e2e.ts) exercises the real Host route, native enforcement, header removal, unsupported policy, packaged assets, and loopback HTTP and UDP sinks.

Unit tests cover finite resource validation, same-address reads, parent-bound challenges, mode selection, failure feedback, and disposal.

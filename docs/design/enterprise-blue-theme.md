> Language: **English** · [简体中文](enterprise-blue-theme.zh-CN.md)

# Enterprise Blue theme specification

This document defines Traqen's default `enterprise` visual theme. Its goal is a professional, stable, evidence-oriented interface for engineering analysis, governance, and traceability work on large desktop displays.

## Design intent

- Blue communicates primary action, selection, and trusted navigation.
- Cyan is reserved for AI, automation, and live activity accents.
- Cool gray creates page hierarchy without reducing information density.
- Green, amber, and red retain strict success, warning, and failure semantics.
- White surfaces and restrained shadows keep complex evidence screens readable.

## Core palette

| Role | Value | Use |
| --- | --- | --- |
| Primary | `#2563EB` | Primary buttons, links, selected navigation, important values |
| Primary hover | `#1D4ED8` | Hovered primary controls and links |
| Primary active | `#1E40AF` | Pressed controls |
| Primary soft | `#EFF6FF` | Selected rows, tabs, and information surfaces |
| Focus ring | `#93C5FD` | Keyboard and form focus |
| Accent cyan | `#06B6D4` | AI, automation, and live activity |
| App background | `#F8FAFC` | Product background |
| Section background | `#F1F5F9` | Secondary regions and disabled surfaces |
| Surface | `#FFFFFF` | Cards, panels, forms, and tables |
| Text primary | `#0F172A` | Titles and important content |
| Text secondary | `#475569` | Body and table content |
| Text tertiary | `#64748B` | Explanations, metadata, and timestamps |
| Border | `#E2E8F0` | Default boundaries and dividers |
| Border strong | `#CBD5E1` | Inputs and emphasized containers |

## Status semantics

| State | Primary | Background | Border | Text |
| --- | --- | --- | --- | --- |
| Success | `#16A34A` | `#F0FDF4` | `#BBF7D0` | `#166534` |
| Warning | `#D97706` | `#FFFBEB` | `#FDE68A` | `#92400E` |
| Error | `#DC2626` | `#FEF2F2` | `#FECACA` | `#991B1B` |
| Info | `#0284C7` | `#F0F9FF` | `#BAE6FD` | `#075985` |

Unknown, pending, failed, and passed results must remain visually distinct. Theme colors never convert an unknown quality state into an apparent success.

## Layout and density

- The sidebar is 268 px wide on desktop and remains the stable Workspace/navigation anchor.
- Main content is capped at 1920 px and uses responsive horizontal padding from 28 to 56 px, preserving comfortable whitespace on a 27-inch display.
- Workspace analysis and graph pages keep a fixed context column with a flexible evidence surface.
- Cards use 8 px radii; important consoles use 12 px; form controls use 6 px.
- Long Agent conversations scroll inside bounded windows rather than extending the entire page.
- Tables retain horizontal scrolling when their evidence columns cannot be compressed safely.

## Component rules

- Active navigation combines a soft-blue surface, blue text/icon, and a 3 px inset indicator.
- Primary buttons use Blue 600, Blue 700 on hover, and Blue 800 when pressed.
- Inputs use a strong cool-gray border and a Blue 300 focus halo.
- Workspace statistics preserve semantic green, amber, and red cards.
- The Analysis Agent console uses a dark navy surface so streaming messages remain distinct from document and evidence panels.
- Feature-tree selection, traceability tabs, tables, review panels, impact panels, metrics, and graphs all consume the same theme tokens.

## Theme behavior

`enterprise` is the default. The global theme control can also select `apple`, `warm`, `fresh`, or `minimal`. The selection is stored only as a local device preference under `traqen-theme`. The root layout applies the stored value before hydration to avoid a visible palette flash; invalid or absent values fall back to `enterprise`.

## Accessibility and responsive behavior

- Text and control contrast must remain readable against their configured surfaces.
- Every interactive control keeps a visible keyboard focus state.
- Theme choice uses `aria-pressed` and does not rely on the color dot alone.
- At narrower widths, theme labels collapse while the color indicators remain available.
- At mobile width, Workspace creation and all multi-column product surfaces collapse to one column.

The complete Chinese specification is available in [enterprise-blue-theme.zh-CN.md](enterprise-blue-theme.zh-CN.md).

/**
 * @paperu/ui — accessible, token-driven primitives.
 *
 * Minimal on purpose. Heavyweight component libraries are avoided
 * (see DEPENDENCIES.md). Each primitive is keyboard-accessible and
 * consumes semantic design tokens.
 */

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

// ── Button ────────────────────────────────────────────────────────

export type ButtonVariant = "accent" | "outline" | "ghost";

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  variant = "outline",
  className,
  type = "button",
  ...rest
}: ButtonProps): ReactNode {
  const cls = ["paperu-btn", `paperu-btn--${variant}`];
  if (className) cls.push(className);
  return <button type={type} className={cls.join(" ")} {...rest} />;
}

// ── Card ───────────────────────────────────────────────────────────

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  as?: "div" | "section" | "article";
}

export function Card({
  as: Tag = "div",
  className,
  ...rest
}: CardProps): ReactNode {
  const cls = ["paperu-card"];
  if (className) cls.push(className);
  return <Tag className={cls.join(" ")} {...rest} />;
}

// ── Visually-hidden (screen reader only) ───────────────────────────

export type VisuallyHiddenProps = HTMLAttributes<HTMLSpanElement>;

export function VisuallyHidden({
  className,
  ...rest
}: VisuallyHiddenProps): ReactNode {
  const cls = ["paperu-sr-only"];
  if (className) cls.push(className);
  return <span className={cls.join(" ")} {...rest} />;
}

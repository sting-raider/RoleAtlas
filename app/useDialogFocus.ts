"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function visibleFocusable(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => {
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && !element.hidden;
  });
}

export function useDialogFocus<T extends HTMLElement>(open: boolean, onClose: () => void, initialFocusSelector?: string, dialogSelector?: string) {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current ?? (dialogSelector ? document.querySelector<T>(dialogSelector) : null);
    if (!dialog) return;

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const preferred = initialFocusSelector ? dialog.querySelector<HTMLElement>(initialFocusSelector) : null;
    const first = preferred ?? visibleFocusable(dialog)[0] ?? dialog;
    queueMicrotask(() => first.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = visibleFocusable(dialog);
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const firstFocusable = focusable[0];
      const lastFocusable = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);
    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      const returnFocus = returnFocusRef.current;
      queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus();
      });
    };
  }, [dialogSelector, initialFocusSelector, open]);

  return dialogRef;
}

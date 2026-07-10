"use client";

import { Modal } from "./Modal";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "実行",
  cancelLabel = "キャンセル",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose} closeDisabled={busy}>
      <p>{message}</p>
      <div className="ui-actions">
        <button
          type="button"
          className="ui-button ui-button-secondary"
          onClick={onClose}
          disabled={busy}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className="ui-button ui-button-danger"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "処理中..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

import type { FolderApi, FolderParams, Pane, TpPluginBundle } from "tweakpane";
import { VERSION } from "tweakpane";

export type FolderButtonConfig = {
  label: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
};

type FolderButtonsParams = FolderParams & {
  buttons: FolderButtonConfig[];
};

const pluginCss = `
.tp-fldb .tp-fldv_b {
  align-items: center;
  display: flex;
  gap: 4px;
  padding-right: 8px;
}
.tp-fldb .tp-fldv_i {
  flex-shrink: 0;
}
.tp-fldb .tp-fldv_t {
  flex: 1;
  min-width: 0;
}
.tp-fldb .tp-fldv_m {
  margin-left: 4px;
  position: static;
}
.tp-fldb .tp-fldb_actions {
  align-items: center;
  display: flex;
  gap: 4px;
}
.tp-fldb .tp-fldb_btn {
  align-items: center;
  background: var(--tp-button-bg, #2c2c2c);
  border: 1px solid var(--tp-button-border-color, #555);
  border-radius: 4px;
  color: var(--tp-label-fg-color, #e0e0e0);
  cursor: pointer;
  display: flex;
  font-size: 12px;
  height: 22px;
  justify-content: center;
  line-height: 1;
  padding: 0;
  width: 22px;
}
.tp-fldb .tp-fldb_btn:disabled {
  cursor: default;
  opacity: 0.55;
}
.tp-fldb .tp-fldb_btn:focus-visible {
  outline: 1px solid var(--tp-button-border-color, #777);
}
`;

function isValidButtonConfig(btn: any): btn is FolderButtonConfig {
  return typeof btn?.label === "string" && typeof btn?.onClick === "function";
}

function attachButtons(
  controller: any,
  buttons: FolderButtonConfig[]
): void {
  if (!buttons.length || !controller?.view?.buttonElement) return;

  const header = controller.view.buttonElement as HTMLElement;
  const root = controller.view.element as HTMLElement;
  const doc = header.ownerDocument;

  root.classList.add("tp-fldb");
  header.classList.add("tp-fldb_header");

  const actions = doc.createElement("div");
  actions.classList.add("tp-fldb_actions");

  const mark = header.querySelector(".tp-fldv_m");
  header.insertBefore(actions, mark ?? null);

  buttons.forEach((btn) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.classList.add("tp-fldb_btn");
    b.textContent = btn.label;
    const title = btn.title ?? btn.label;
    b.title = title;
    b.setAttribute("aria-label", title);
    if (btn.disabled) b.disabled = true;
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      btn.onClick();
    });
    actions.appendChild(b);
  });

  controller.viewProps.handleDispose(() => {
    actions.replaceChildren();
  });
}

export function registerFolderButtonsPlugin(pane: Pane): void {
  const anyPane = pane as any;
  if (anyPane.__folderButtonsPluginRegistered) return;

  const pool = anyPane.pool_;
  const baseFolderPlugin = pool?.pluginsMap_?.blades?.find(
    (p: any) => p.id === "folder"
  );
  if (!baseFolderPlugin) {
    console.warn("[folder-buttons] base folder plugin not found; skipping.");
    return;
  }

  const folderButtonsPlugin = {
    id: "folder-buttons",
    type: "blade",
    core: baseFolderPlugin.core ?? VERSION,
    accept(params: any) {
      if (params.view !== "folder") return null;
      const buttons = Array.isArray(params.buttons)
        ? params.buttons.filter(isValidButtonConfig)
        : [];
      if (!buttons.length) return null;
      return { params: { ...params, buttons } as FolderButtonsParams };
    },
    controller(args: any) {
      const { buttons, ...rest } = args.params as FolderButtonsParams;
      const controller = baseFolderPlugin.controller({
        ...args,
        params: rest,
      });
      attachButtons(controller, buttons);
      return controller;
    },
    api(args: { controller: any; pool: any }) {
      return baseFolderPlugin.api(args) as FolderApi | null;
    },
  };

  const bundle: TpPluginBundle = {
    id: "folder-buttons",
    plugin: folderButtonsPlugin as any,
    css: pluginCss,
  };

  pane.registerPlugin(bundle);
  anyPane.__folderButtonsPluginRegistered = true;
}



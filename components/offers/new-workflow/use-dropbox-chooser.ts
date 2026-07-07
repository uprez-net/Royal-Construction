"use client";

import { useCallback, useEffect, useState } from "react";

export type DropboxChooserFile = {
  readonly link: string;
  readonly name: string;
  readonly bytes: number;
};

type DropboxChooseOptions = {
  success: (files: DropboxChooserFile[]) => void;
  cancel?: () => void;
  linkType?: "preview" | "direct";
  multiselect?: boolean;
  extensions?: readonly string[];
};

declare global {
  interface Window {
    Dropbox?: {
      choose: (options: DropboxChooseOptions) => void;
    };
  }
}

const APP_KEY = process.env.NEXT_PUBLIC_DROPBOX_APP_KEY;
const SCRIPT_ID = "dropboxjs";
const SCRIPT_SRC = "https://www.dropbox.com/static/api/2/dropins.js";

// Loads Dropbox's Chooser drop-in and exposes a promise-based picker. `choose`
// resolves with the selected image files (direct links, valid at pick time) or
// an empty array if cancelled/unavailable.
export function useDropboxChooser() {
  const configured = Boolean(APP_KEY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!configured) {
      return;
    }
    if (window.Dropbox) {
      setReady(true);
      return;
    }
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => setReady(true));
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.setAttribute("data-app-key", APP_KEY as string);
    script.onload = () => setReady(true);
    document.body.appendChild(script);
  }, [configured]);

  const choose = useCallback((): Promise<DropboxChooserFile[]> => {
    return new Promise((resolve) => {
      if (!window.Dropbox) {
        resolve([]);
        return;
      }
      window.Dropbox.choose({
        linkType: "direct",
        multiselect: true,
        extensions: ["images"],
        success: (files) => resolve(files),
        cancel: () => resolve([]),
      });
    });
  }, []);

  return { configured, ready, choose };
}

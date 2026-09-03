import '@strudel/repl';

import { useEffect, useRef } from 'react';

import {
  StrudelReplWorkspace,
  type StrudelReplElement,
} from '../adapters/strudel/strudel-repl-workspace.ts';

type StrudelEditorProps = Readonly<{
  initialCode: string;
  onWorkspaceReady: (workspace: StrudelReplWorkspace | null) => void;
}>;

/** Mounts Strudel's custom element and exposes its application adapter once connected. */
export const StrudelEditor = ({
  initialCode,
  onWorkspaceReady,
}: StrudelEditorProps): React.JSX.Element => {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (mount === null) return;

    // SAFETY: Importing @strudel/repl registers this tag, whose runtime shape is isolated by the adapter.
    const element = document.createElement('strudel-editor') as StrudelReplElement;
    element.setAttribute('code', initialCode);
    mount.append(element);

    const workspace = new StrudelReplWorkspace(element);
    onWorkspaceReady(workspace);

    return () => {
      onWorkspaceReady(null);
      void workspace.stop();
      // Strudel inserts CodeMirror beside its custom element, so both nodes belong to this mount.
      mount.replaceChildren();
    };
  }, [initialCode, onWorkspaceReady]);

  return <div className="editor-mount" ref={mountRef} />;
};

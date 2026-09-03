declare module '@strudel/repl' {}
declare module '@strudel/repl/repl-component.mjs' {}

declare module '@strudel/webaudio' {
  export function getAudioContext(): AudioContext;

  export function getSuperdoughAudioController(): Readonly<{
    output: Readonly<{
      destinationGain: GainNode;
    }>;
  }>;
}

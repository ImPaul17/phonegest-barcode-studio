import LiquidGlass from 'liquid-glass-react';

const STILL = { x: 0, y: 0 };

export default function LiquidGlassLens() {
  return (
    <div className="liquid-glass-lens" aria-hidden="true" inert>
      <LiquidGlass
        className="liquid-glass-lens-body"
        style={{ position: 'absolute', left: '50%', top: '50%', width: '100%', height: '100%' }}
        mode="standard"
        padding="0"
        cornerRadius={24}
        displacementScale={35}
        blurAmount={0.09}
        saturation={135}
        aberrationIntensity={1.5}
        elasticity={0}
        globalMousePos={STILL}
        mouseOffset={STILL}
      >
        {null}
      </LiquidGlass>
    </div>
  );
}

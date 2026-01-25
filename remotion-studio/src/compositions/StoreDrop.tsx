import React from 'react';
import { AbsoluteFill, useCurrentFrame, spring, useVideoConfig } from 'remotion';

export const StoreDrop: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    const scale = spring({ frame, fps, config: { damping: 10 } });

    return (
        <AbsoluteFill style={{ backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' }}>
            <h1 style={{
                fontSize: 100,
                fontFamily: 'Impact, sans-serif',
                transform: `scale(${scale})`,
                color: frame % 5 === 0 ? 'red' : 'black'
            }}>
                NEW DROP
            </h1>
            <h2 style={{ fontSize: 40, marginTop: 20, opacity: frame > 30 ? 1 : 0 }}>
                AVAILABLE NOW
            </h2>
        </AbsoluteFill>
    );
};

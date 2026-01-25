import React from 'react';
import { AbsoluteFill } from 'remotion';

export const DeepWikiIntro: React.FC = () => {
    return (
        <AbsoluteFill style={{ backgroundColor: 'white', justifyContent: 'center', alignItems: 'center' }}>
            <h1 style={{ fontFamily: 'Arial', fontSize: 80 }}>Welcome to Smol FE</h1>
        </AbsoluteFill>
    );
};

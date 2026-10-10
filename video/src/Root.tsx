import React from 'react'
import { Composition } from 'remotion'
import { DURATION, FPS, Video } from './Video'

export const Root: React.FC = () => (
  <Composition id="Sorabi" component={Video} width={1920} height={1080} fps={FPS} durationInFrames={DURATION} defaultProps={{ music: null as string | null, end: 'b' as const }} />
)

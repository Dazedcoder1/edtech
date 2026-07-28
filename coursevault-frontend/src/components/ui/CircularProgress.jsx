import React from 'react';

export default function CircularProgress({ size = 'medium', percentage = 0, color = '#F26B4D', label = '' }) {
    const sizeMap = { small: 48, medium: 84, large: 140 };
    const sqSize = sizeMap[size] || 84;
    const strokeWidth = sqSize * 0.12;
    const radius = (sqSize - strokeWidth) / 2;
    const viewBox = `0 0 ${sqSize} ${sqSize}`;
    const dashArray = radius * Math.PI * 2;
    const dashOffset = dashArray - (dashArray * percentage) / 100;

    return (
        <div className="flex flex-col items-center justify-center">
            <svg width={sqSize} height={sqSize} viewBox={viewBox} className="block">
                <circle
                    className="text-gray-200"
                    fill="none"
                    stroke="currentColor"
                    cx={sqSize / 2}
                    cy={sqSize / 2}
                    r={radius}
                    strokeWidth={strokeWidth}
                />
                <circle
                    fill="none"
                    stroke={color}
                    cx={sqSize / 2}
                    cy={sqSize / 2}
                    r={radius}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={dashArray}
                    strokeDashoffset={dashOffset}
                    style={{
                        transition: 'stroke-dashoffset 0.8s ease 0s',
                        transform: 'rotate(-90deg)',
                        transformOrigin: '50% 50%'
                    }}
                />
                <text
                    x="50%"
                    y="50%"
                    dy=".3em"
                    textAnchor="middle"
                    className="font-bold fill-current text-black"
                    style={{ fontSize: sqSize * 0.25 }}
                >
                    {percentage}%
                </text>
            </svg>
            {label && <span className="text-[10px] font-bold mt-1 tracking-wider">{label}</span>}
        </div>
    );
}
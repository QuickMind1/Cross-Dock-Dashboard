export function formatDriveTime(driveTime) {
    if (!driveTime) return '<span class="text-slate-400 italic">N/A</span>';
    const hours = Math.floor(driveTime / 3600);
    const minutes = Math.floor((driveTime % 3600) / 60);

    if (hours > 0) return `${hours} h. ${minutes} min.`;
    return `${minutes} min.`;
}
// Bottom of the screen, centred: the skill bar, then your level and XP bar,
// then how many enemy ships you've destroyed and what they were worth.

import type { Game, HudInfo } from './game/Game';
import { SkillBar } from './SkillBar';

export function BottomHud({ hud, game }: { hud: HudInfo; game: Game | null }) {
  return (
    <div className="bottom-hud">
      <SkillBar hud={hud} game={game} />
      <div className="xp-row">
        <span className="level">Level {hud.level}</span>
        <span className="xp-bar">
          <span style={{ width: `${Math.min(100, (hud.xp / hud.xpNext) * 100)}%` }} />
        </span>
        <span className="hint">
          {Math.floor(hud.xp)} / {hud.xpNext} XP
        </span>
      </div>
      <div className="kill-counters">
        Ships destroyed: {hud.stats.kills} · Value destroyed: {hud.stats.killValue}
      </div>
    </div>
  );
}

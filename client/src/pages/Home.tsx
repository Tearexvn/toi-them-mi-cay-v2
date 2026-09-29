import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { trpc } from "@/lib/trpc";
import { RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getSecretHoldProgress,
  getUnlockedAchievements,
  isSecretHoldComplete,
  NOODLE_ACHIEVEMENTS,
  ROBOT_CONFESSION_TAPS_REQUIRED,
  SECRET_HOLD_DURATION_MS,
} from "@shared/noodle-achievements";
import { leaderboardSelectionReducer, type LeaderboardBoard } from "@shared/leaderboard-selection";
import {
  CLICK_HISTORY_LIMIT,
  CLICK_RATE_WINDOW_MS,
  detectSuspiciousClickPattern,
} from "@shared/anti-auto-click";
import { interleaveNoodleAndTopping } from "@shared/noodle-particles";
import {
  addNoodleExperience,
  didNoodleLevelUp,
  getNoodleLevelProgress,
  maxNoodleExperience,
  removeNoodleExperience,
} from "@shared/noodle-level";

type Mood = "beef" | "chicken" | "octopus";
type Board = LeaderboardBoard;
type AchievementTab = "achievements" | "special";
type ParticleStyle = CSSProperties & {
  "--dx": string;
  "--dy": string;
  "--rot": string;
  "--duration": string;
};
type FireStyle = CSSProperties & {
  "--fire-duration": string;
  "--fire-drift": string;
};
type FireworkStyle = CSSProperties & {
  "--firework-x": string;
  "--firework-y": string;
  "--firework-delay": string;
  "--firework-color": string;
  "--firework-size": string;
};
type HoldButtonStyle = CSSProperties & { "--hold-progress": number };
type XpGainStyle = CSSProperties & { "--xp-drift": string };

const moods: { id: Mood; label: string; emoji: string; note: string }[] = [
  { id: "beef", label: "Bò", emoji: "🥩", note: "BÒ CHÍN TỚI" },
  { id: "chicken", label: "Đùi gà", emoji: "🍗", note: "GÀ GIÒN TAN" },
  { id: "octopus", label: "Bạch tuộc", emoji: "🐙", note: "BẠCH TUỘC GIÒN SỰT" },
];

const boards: { id: Board; label: string; emoji: string }[] = [
  { id: "total", label: "Tổng", emoji: "🏆" },
  { id: "beef", label: "Mì bò", emoji: "🥩" },
  { id: "chicken", label: "Mì đùi gà", emoji: "🍗" },
  { id: "octopus", label: "Mì bạch tuộc", emoji: "🐙" },
];

const TOKEN_KEY = "mi-cay-player-token";
const NAME_KEY = "mi-cay-player-name";
const fireEmojis = ["🔥", "🔥", "✨", "🔥", "🧨"];

function createFireDrops() {
  const createdAt = Date.now();
  return Array.from({ length: 34 }, (_, index) => ({
    id: `${createdAt}-${index}-${Math.random()}`,
    emoji: fireEmojis[Math.floor(Math.random() * fireEmojis.length)],
    style: {
      left: `${Math.random() * 100}%`,
      top: "-38px",
      fontSize: `${16 + Math.random() * 20}px`,
      animationDelay: `${Math.random() * 420}ms`,
      "--fire-duration": `${1850 + Math.random() * 850}ms`,
      "--fire-drift": `${Math.random() * 170 - 85}px`,
    } as FireStyle,
  }));
}

function createAchievementFireworks() {
  const colors = ["#ffcf66", "#ff6545", "#ff9f43", "#fff1b8", "#f04a32"];
  return Array.from({ length: 54 }, (_, index) => {
    const burstIndex = Math.floor(index / 18);
    const angle = ((index % 18) / 18) * Math.PI * 2 + Math.random() * 0.12;
    const distance = 54 + Math.random() * 112;
    return {
      id: `${Date.now()}-${index}-${Math.random()}`,
      symbol: index % 4 === 0 ? "✦" : index % 4 === 1 ? "✧" : "•",
      style: {
        left: `${22 + burstIndex * 28 + Math.random() * 5}%`,
        top: `${9 + Math.random() * 17}%`,
        "--firework-x": `${Math.cos(angle) * distance}px`,
        "--firework-y": `${Math.sin(angle) * distance}px`,
        "--firework-delay": `${Math.random() * 150}ms`,
        "--firework-color": colors[Math.floor(Math.random() * colors.length)],
        "--firework-size": `${10 + Math.random() * 14}px`,
      } as FireworkStyle,
    };
  });
}

function createXpGainPop() {
  return {
    id: `${Date.now()}-${Math.random()}`,
    style: {
      left: `${44 + Math.random() * 12}%`,
      "--xp-drift": `${Math.random() * 36 - 18}px`,
    } as XpGainStyle,
  };
}

function readSession(key: string) {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function medalFor(rank: number) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return String(rank).padStart(2, "0");
}

export default function Home() {
  const [mood, setMood] = useState<Mood>("beef");
  const [activeBoard, dispatchBoard] = useReducer(leaderboardSelectionReducer, "total");
  const [particles, setParticles] = useState<{ id: number; emoji: string; style: ParticleStyle }[]>([]);
  const [fireDrops, setFireDrops] = useState<ReturnType<typeof createFireDrops>>([]);
  const [achievementFireworks, setAchievementFireworks] = useState<ReturnType<typeof createAchievementFireworks>>([]);
  const [xpGainPops, setXpGainPops] = useState<ReturnType<typeof createXpGainPop>[]>([]);
  const [achievementDialogOpen, setAchievementDialogOpen] = useState(false);
  const [activeAchievementTab, setActiveAchievementTab] = useState<AchievementTab>("achievements");
  const [achievementToastOpen, setAchievementToastOpen] = useState(false);
  const [robotAchievementToastOpen, setRobotAchievementToastOpen] = useState(false);
  const [robotAchievementToastText, setRobotAchievementToastText] = useState("Bạn đã nhận thành tựu ẩn “robot ăn mì”");
  const [antiClickWarningOpen, setAntiClickWarningOpen] = useState(false);
  const [antiClickChallengeReady, setAntiClickChallengeReady] = useState(false);
  const [robotConfessionCount, setRobotConfessionCount] = useState(0);
  const [robotEaterUnlockedLocal, setRobotEaterUnlockedLocal] = useState(false);
  const [robotButtonRect, setRobotButtonRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const robotDialogBodyRef = useRef<HTMLDivElement | null>(null);
  const [burnedFingerUnlockedLocal, setBurnedFingerUnlockedLocal] = useState(false);
  const [antiClickAchievementUnlockedLocal, setAntiClickAchievementUnlockedLocal] = useState(false);
  const [isHoldingNoodle, setIsHoldingNoodle] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [isExploding, setIsExploding] = useState(false);
  const [optimisticExperience, setOptimisticExperience] = useState<string | null>(null);
  const optimisticExperienceRef = useRef<string | null>(null);
  const noodleButtonRef = useRef<HTMLButtonElement | null>(null);
  const holdStartedAtRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const robotToastTimeoutRef = useRef<number | null>(null);
  const clientClickTimestampsRef = useRef<number[]>([]);
  const clientClickBlockedUntilRef = useRef(0);
  const fireworksTimeoutRef = useRef<number | null>(null);
  const explosionTimeoutRef = useRef<number | null>(null);
  const [playerToken, setPlayerToken] = useState(() => readSession(TOKEN_KEY));
  const [playerName, setPlayerName] = useState(() => readSession(NAME_KEY));
  const [draftName, setDraftName] = useState("");
  const [notice, setNotice] = useState("");

  const utils = trpc.useUtils();

  function showAntiClickWarning() {
    setRobotConfessionCount(0);
    setAntiClickChallengeReady(false);
    setAntiClickWarningOpen(true);
  }

  const leaderboardInput = useMemo(
    () => ({ token: playerToken || undefined, board: activeBoard }),
    [playerToken, activeBoard],
  );
  const leaderboard = trpc.noodle.leaderboard.useQuery(
    leaderboardInput,
    { refetchInterval: 10_000, refetchOnWindowFocus: true, retry: 1 },
  );
  const unlockAchievement = trpc.noodle.unlockBurnedFinger.useMutation({
    onSuccess: (result) => {
      setBurnedFingerUnlockedLocal(true);
      if (!result.newlyUnlocked) return;
      setAchievementToastOpen(true);
      if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
      toastTimeoutRef.current = window.setTimeout(() => setAchievementToastOpen(false), 5_500);
      void utils.noodle.leaderboard.invalidate();
    },
    onError: (error) => {
      holdTriggeredRef.current = false;
      setNotice(error.message || "Chưa lưu được thành tựu. Thử giữ lại lần nữa nhé.");
    },
  });
  function refreshLeaderboard() {
    dispatchBoard({ type: "refresh" });
    void leaderboard.refetch();
  }
  useEffect(() => {
    const cancelHoldOnHiddenPage = () => {
      if (!document.hidden) return;
      holdStartedAtRef.current = null;
      if (holdIntervalRef.current !== null) window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
      setIsHoldingNoodle(false);
      setHoldProgress(0);
    };
    document.addEventListener("visibilitychange", cancelHoldOnHiddenPage);
    return () => {
      document.removeEventListener("visibilitychange", cancelHoldOnHiddenPage);
      if (holdIntervalRef.current !== null) window.clearInterval(holdIntervalRef.current);
      if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
      if (robotToastTimeoutRef.current !== null) window.clearTimeout(robotToastTimeoutRef.current);
      if (fireworksTimeoutRef.current !== null) window.clearTimeout(fireworksTimeoutRef.current);
      if (explosionTimeoutRef.current !== null) window.clearTimeout(explosionTimeoutRef.current);
    };
  }, []);
  useEffect(() => {
    if (!antiClickWarningOpen) {
      setRobotButtonRect(null);
      return;
    }
    let frame = 0;
    const updatePosition = () => {
      const button = noodleButtonRef.current?.getBoundingClientRect();
      const dialogBody = robotDialogBodyRef.current?.getBoundingClientRect();
      if (!button || !dialogBody) return;
      setRobotButtonRect({
        left: button.left - dialogBody.left,
        top: button.top - dialogBody.top,
        width: button.width,
        height: button.height,
      });
    };
    frame = window.requestAnimationFrame(updatePosition);
    const settleTimer = window.setTimeout(updatePosition, 280);
    const finalTimer = window.setTimeout(updatePosition, 620);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.clearTimeout(finalTimer);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [antiClickWarningOpen]);
  useEffect(() => {
    const player = leaderboard.data?.player;
    if (!player?.robotChallengeActive) return;
    setRobotConfessionCount(player.robotConfessionCount);
    setAntiClickChallengeReady(true);
    setAntiClickWarningOpen(true);
  }, [leaderboard.data?.player?.robotChallengeActive, leaderboard.data?.player?.robotConfessionCount]);
  const joinPlayer = trpc.noodle.join.useMutation({
    onSuccess: (session) => {
      try {
        window.localStorage.setItem(TOKEN_KEY, session.token);
        window.localStorage.setItem(NAME_KEY, session.name);
      } catch {
        setNotice("Thiết bị đang chặn lưu phiên. Lần sau bạn có thể cần nhập lại tên.");
      }
      setPlayerToken(session.token);
      setPlayerName(session.name);
      setBurnedFingerUnlockedLocal(session.burnedFingerUnlocked);
      setRobotEaterUnlockedLocal(session.robotEaterUnlocked);
      holdTriggeredRef.current = false;
      clientClickTimestampsRef.current = [];
      clientClickBlockedUntilRef.current = 0;
      setDraftName("");
      setAntiClickAchievementUnlockedLocal(session.antiClickAchievementUnlocked);
      setAntiClickWarningOpen(false);
      setAntiClickChallengeReady(false);
      setRobotConfessionCount(0);
      optimisticExperienceRef.current = null;
      setOptimisticExperience(null);
      setXpGainPops([]);
      setNotice(session.returning
        ? `Chào ${session.name}! Đã vào lại hồ sơ, điểm cũ còn nguyên.`
        : `Chào ${session.name}! Bấm mì là lên bảng.`);
      void utils.noodle.leaderboard.invalidate();
    },
  });
  const activateNoodleBoost = trpc.noodle.activateNoodleBoost.useMutation();
  const recordClick = trpc.noodle.click.useMutation({
    onSuccess: async (result, variables) => {
      if (variables.token === playerToken) {
        if (result.accepted) {
          const reconciled = maxNoodleExperience(
            optimisticExperienceRef.current ?? result.experience,
            result.experience,
          );
          optimisticExperienceRef.current = reconciled;
          setOptimisticExperience(reconciled);
        } else {
          if (!variables.clientFlagged) {
            const rolledBack = removeNoodleExperience(optimisticExperienceRef.current ?? experience);
            optimisticExperienceRef.current = rolledBack;
            setOptimisticExperience(rolledBack);
          }
          setParticles([]);
          setXpGainPops([]);
          setFireDrops([]);
          setAntiClickAchievementUnlockedLocal(result.antiClickAchievementUnlocked);
          setAchievementToastOpen(false);
          if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
          showAntiClickWarning();
          setAntiClickChallengeReady(true);
          if (result.newlyUnlockedAntiClick) {
            const fireworks = createAchievementFireworks();
            setAchievementFireworks(fireworks);
            if (fireworksTimeoutRef.current !== null) window.clearTimeout(fireworksTimeoutRef.current);
            fireworksTimeoutRef.current = window.setTimeout(() => setAchievementFireworks([]), 2_500);
          }
        }
      }
      await utils.noodle.leaderboard.invalidate();
    },
    onError: async (error, variables) => {
      if (variables.token === playerToken && !variables.clientFlagged) {
        const rolledBack = removeNoodleExperience(optimisticExperienceRef.current ?? experience);
        optimisticExperienceRef.current = rolledBack;
        setOptimisticExperience(rolledBack);
      }
      if (!variables.clientFlagged) setNotice(error.message || "Không ghi được lượt bấm. Thử lại nhé.");
      await utils.noodle.leaderboard.invalidate();
    },
  });
  const robotConfession = trpc.noodle.confessAsRobot.useMutation({
    onSuccess: async (result) => {
      setRobotConfessionCount(result.confessionCount);
      if (result.unlocked) {
        setRobotEaterUnlockedLocal(true);
        setRobotAchievementToastOpen(true);
        if (robotToastTimeoutRef.current !== null) window.clearTimeout(robotToastTimeoutRef.current);
        robotToastTimeoutRef.current = window.setTimeout(() => setRobotAchievementToastOpen(false), 5_500);
        const fireworks = createAchievementFireworks();
        setAchievementFireworks(fireworks);
        if (fireworksTimeoutRef.current !== null) window.clearTimeout(fireworksTimeoutRef.current);
        fireworksTimeoutRef.current = window.setTimeout(() => setAchievementFireworks([]), 2_500);
        await utils.noodle.leaderboard.invalidate();
      }
    },
    onError: (error) => setNotice(error.message || "Chưa ghi nhận được lần thú nhận này."),
  });
  const resetRobotChallenge = trpc.noodle.resetRobotConfession.useMutation();
  function closeAntiClickWarning() {
    setAntiClickWarningOpen(false);
    setAntiClickChallengeReady(false);
    setRobotConfessionCount(0);
    if (playerToken) resetRobotChallenge.mutate({ token: playerToken });
  }

  const activeMood = moods.find((item) => item.id === mood) ?? moods[0];
  const lastRecordedTotalClicks = recordClick.variables?.token === playerToken
    ? recordClick.data?.totalClicks ?? 0
    : 0;
  const totalClicks = Math.max(leaderboard.data?.player?.totalClicks ?? 0, lastRecordedTotalClicks);
  const activeBoardLabel = boards.find((board) => board.id === activeBoard)?.label ?? "Tổng";
  const lastRecordedExperience = recordClick.variables?.token === playerToken ? recordClick.data?.experience : undefined;
  const serverExperience = lastRecordedExperience ?? leaderboard.data?.player?.experience ?? "0";
  const experience = optimisticExperience === null
    ? serverExperience
    : maxNoodleExperience(serverExperience, optimisticExperience);
  const levelProgress = useMemo(() => getNoodleLevelProgress(experience), [experience]);
  const burnedFingerUnlocked = burnedFingerUnlockedLocal || Boolean(leaderboard.data?.player?.burnedFingerUnlocked);
  const antiClickAchievementUnlocked = antiClickAchievementUnlockedLocal || Boolean(leaderboard.data?.player?.antiClickAchievementUnlocked);
  const robotEaterUnlocked = robotEaterUnlockedLocal || Boolean(leaderboard.data?.player?.robotEaterUnlocked);
  const specialAchievements = useMemo(
    () => getUnlockedAchievements(burnedFingerUnlocked, antiClickAchievementUnlocked, robotEaterUnlocked),
    [burnedFingerUnlocked, antiClickAchievementUnlocked, robotEaterUnlocked],
  );
  const unlockedAchievements = useMemo(
    () => [...NOODLE_ACHIEVEMENTS, ...specialAchievements],
    [specialAchievements],
  );
  const visibleAchievements = activeAchievementTab === "achievements"
    ? NOODLE_ACHIEVEMENTS
    : specialAchievements;

  function completeBurnerHold() {
    if (holdTriggeredRef.current || !playerToken || burnedFingerUnlocked) return;
    holdTriggeredRef.current = true;
    holdStartedAtRef.current = null;
    if (holdIntervalRef.current !== null) window.clearInterval(holdIntervalRef.current);
    holdIntervalRef.current = null;
    setIsHoldingNoodle(false);
    setHoldProgress(1);
    setIsExploding(true);
    if (explosionTimeoutRef.current !== null) window.clearTimeout(explosionTimeoutRef.current);
    explosionTimeoutRef.current = window.setTimeout(() => setIsExploding(false), 650);
    const fireworks = createAchievementFireworks();
    setAchievementFireworks(fireworks);
    if (fireworksTimeoutRef.current !== null) window.clearTimeout(fireworksTimeoutRef.current);
    fireworksTimeoutRef.current = window.setTimeout(() => setAchievementFireworks([]), 2_500);
    unlockAchievement.mutate({ token: playerToken });
  }

  function beginBurnerHold() {
    if (!playerToken || !leaderboard.data?.player || burnedFingerUnlocked || holdStartedAtRef.current !== null || holdTriggeredRef.current) return;
    holdStartedAtRef.current = Date.now();
    setHoldProgress(0);
    setIsHoldingNoodle(true);
    holdIntervalRef.current = window.setInterval(() => {
      const startedAt = holdStartedAtRef.current;
      if (startedAt === null) return;
      const elapsed = Date.now() - startedAt;
      setHoldProgress(getSecretHoldProgress(elapsed));
      if (isSecretHoldComplete(elapsed)) completeBurnerHold();
    }, 40);
  }

  function endBurnerHold() {
    const startedAt = holdStartedAtRef.current;
    if (startedAt === null) return;
    if (isSecretHoldComplete(Date.now() - startedAt)) {
      completeBurnerHold();
      return;
    }
    holdStartedAtRef.current = null;
    if (holdIntervalRef.current !== null) window.clearInterval(holdIntervalRef.current);
    holdIntervalRef.current = null;
    setIsHoldingNoodle(false);
    setHoldProgress(0);
  }

  function makeItRain() {
    if (!playerToken) {
      setNotice("Nhập tên trước để được ghi tên lên BXH nha.");
      document.getElementById("player-name")?.focus();
      return;
    }

    const now = Date.now();
    if (now < clientClickBlockedUntilRef.current) return;
    const clickTimestamps = [...clientClickTimestampsRef.current, now].slice(-CLICK_HISTORY_LIMIT);
    clientClickTimestampsRef.current = clickTimestamps;
    const suspiciousClickReason = detectSuspiciousClickPattern(clickTimestamps, now);
    if (suspiciousClickReason) {
      clientClickTimestampsRef.current = [];
      clientClickBlockedUntilRef.current = now + CLICK_RATE_WINDOW_MS;
      setParticles([]);
      setXpGainPops([]);
      setFireDrops([]);
      showAntiClickWarning();
      recordClick.mutate({ token: playerToken, mood, clientFlagged: true });
      return;
    }

    const burstEmojis = interleaveNoodleAndTopping(activeMood.emoji, 14);
    const newParticles = Array.from({ length: 14 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 14 + Math.random() * 0.5;
      const distance = 150 + Math.random() * 240;
      const id = now + index;
      return {
        id,
        emoji: burstEmojis[index] ?? "🍜",
        style: {
          "--dx": `${Math.cos(angle) * distance}px`,
          "--dy": `${Math.sin(angle) * distance - 55}px`,
          "--rot": `${Math.random() * 100 - 50}deg`,
          "--duration": `${850 + Math.random() * 550}ms`,
          left: "50%",
          top: "61%",
          animationDelay: `${Math.random() * 100}ms`,
          fontSize: `${22 + Math.random() * 17}px`,
        } as ParticleStyle,
      };
    });

    setParticles((current) => [...current.slice(-28), ...newParticles]);
    setNotice("");
    const previousExperience = optimisticExperienceRef.current ?? experience;
    const nextExperience = addNoodleExperience(previousExperience);
    optimisticExperienceRef.current = nextExperience;
    setOptimisticExperience(nextExperience);
    const xpGain = createXpGainPop();
    setXpGainPops((current) => [...current.slice(-5), xpGain]);
    window.setTimeout(() => {
      setXpGainPops((current) => current.filter((pop) => pop.id !== xpGain.id));
    }, 900);
    if (didNoodleLevelUp(previousExperience, nextExperience)) {
      const drops = createFireDrops();
      const expiredIds = new Set(drops.map((drop) => drop.id));
      setFireDrops((current) => [...current.slice(-34), ...drops]);
      window.setTimeout(() => {
        setFireDrops((current) => current.filter((drop) => !expiredIds.has(drop.id)));
      }, 3300);
    }
    recordClick.mutate({ token: playerToken, mood, clientFlagged: false });
    window.setTimeout(() => {
      setParticles((current) => current.filter((particle) => !newParticles.some((created) => created.id === particle.id)));
    }, 1600);
  }

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draftName.trim().replace(/\s+/g, " ");
    if (!name) {
      setNotice("Nhập tên trước đã nhé.");
      return;
    }
    setNotice("");
    joinPlayer.mutate({ name, token: playerToken || undefined });
  }

  function leavePlayer() {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(NAME_KEY);
    } catch {
      // The in-memory session can still be cleared if storage is unavailable.
    }
    setPlayerToken("");
    setPlayerName("");
    setBurnedFingerUnlockedLocal(false);
    setAntiClickAchievementUnlockedLocal(false);
    setRobotEaterUnlockedLocal(false);
    setAntiClickWarningOpen(false);
    setAntiClickChallengeReady(false);
    setRobotConfessionCount(0);
    clientClickTimestampsRef.current = [];
    clientClickBlockedUntilRef.current = 0;
    holdTriggeredRef.current = false;
    holdStartedAtRef.current = null;
    if (holdIntervalRef.current !== null) window.clearInterval(holdIntervalRef.current);
    holdIntervalRef.current = null;
    setIsHoldingNoodle(false);
    setHoldProgress(0);
    optimisticExperienceRef.current = null;
    setOptimisticExperience(null);
    setXpGainPops([]);
    setFireDrops([]);
    setNotice("Đã thoát khỏi lượt chơi. Điểm cũ vẫn nằm trên BXH nhé.");
    void utils.noodle.leaderboard.invalidate();
  }

  const nameError = joinPlayer.error?.message;
  const leaderboardError = leaderboard.error?.message;
  const honeypotKey = leaderboard.data?.player?.honeypotKey ?? "";

  return (
    <main className="site-shell" data-theme={mood}>
      <div className="paper-grain" aria-hidden="true" />
      <button
        className="hidden-noodle-boost"
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        title="Nhận mì cay x2 miễn phí"
        aria-label="Nhận mì cay x2 miễn phí"
        data-bonus="x2"
        onClick={() => {
          if (playerToken && honeypotKey && !activateNoodleBoost.isPending) {
            activateNoodleBoost.mutate({ token: playerToken, honeypotKey });
          }
        }}
      >Nhận mì cay x2 miễn phí</button>
      {fireDrops.length > 0 && (
        <div className="level-up-rain" aria-hidden="true">
          {fireDrops.map((drop) => <span key={drop.id} className="fire-drop" style={drop.style}>{drop.emoji}</span>)}
        </div>
      )}
      {achievementFireworks.length > 0 && (
        <div className="achievement-fireworks" aria-hidden="true">
          {achievementFireworks.map((spark) => <span key={spark.id} className="achievement-firework" style={spark.style}>{spark.symbol}</span>)}
        </div>
      )}
      {achievementToastOpen && (
        <div className="achievement-toast-wrap">
          <div className="achievement-toast" role="status" aria-live="polite" aria-atomic="true">
            <span className="achievement-toast-icon" aria-hidden="true">🏆</span>
            <span className="achievement-toast-copy">Bạn đã nhận được thành tựu ẩn <strong>“Bỏng tay chưa?”</strong></span>
            <button
              className="achievement-toast-close"
              type="button"
              aria-label="Đóng thông báo thành tựu"
              onClick={() => {
                setAchievementToastOpen(false);
                if (toastTimeoutRef.current !== null) window.clearTimeout(toastTimeoutRef.current);
              }}
            >×</button>
          </div>
        </div>
      )}
      {robotAchievementToastOpen && (
        <div className="achievement-toast-wrap">
          <div className="achievement-toast anti-click-toast" role="status" aria-live="polite" aria-atomic="true">
            <span className="achievement-toast-icon" aria-hidden="true">🤖</span>
            <span className="achievement-toast-copy">Bạn đã nhận được thành tựu ẩn <strong>“robot ăn mì”</strong></span>
            <button className="achievement-toast-close" type="button" aria-label="Đóng thông báo thành tựu robot" onClick={() => setRobotAchievementToastOpen(false)}>×</button>
          </div>
        </div>
      )}
      <Dialog open={antiClickWarningOpen} onOpenChange={(open) => { if (open) setAntiClickWarningOpen(true); }}>
        <DialogContent
          className="robot-warning-dialog"
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
          aria-describedby="robot-warning-description"
        >
          <div className="robot-warning-body" ref={robotDialogBodyRef}>
            <button className="robot-warning-close" type="button" aria-label="Đóng cảnh báo" onClick={closeAntiClickWarning}>×</button>
            <div className="robot-warning-icon" aria-hidden="true">🤖</div>
            <DialogHeader className="robot-warning-header">
              <DialogTitle className="robot-warning-title">nghẹn mì cay rồi chậm lại tí!</DialogTitle>
              <DialogDescription id="robot-warning-description" className="robot-warning-description">
                không biết nghẹn hay sao mà ăn nhanh thế? hay bạn là...
              </DialogDescription>
            </DialogHeader>
            <p className="robot-confession-progress" aria-live="polite">
              {antiClickChallengeReady
                ? `Tôi là robot: ${robotConfessionCount} / 10`
                : "Đang xác nhận lượt bấm bị chặn…"}
            </p>
            {robotButtonRect && (
              <button
                className="robot-confession-button"
                type="button"
                style={{ left: robotButtonRect.left, top: robotButtonRect.top, width: robotButtonRect.width, height: robotButtonRect.height }}
                disabled={!antiClickChallengeReady || robotConfession.isPending || robotConfessionCount >= ROBOT_CONFESSION_TAPS_REQUIRED}
                onClick={() => playerToken && robotConfession.mutate({ token: playerToken })}
              >
                {robotConfession.isPending ? "…" : "Tôi là robot"}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <div className="ambient ambient-one" aria-hidden="true">{activeMood.emoji}</div>
      <div className="ambient ambient-two" aria-hidden="true">🌶️</div>
      <div className="ambient ambient-three" aria-hidden="true">{activeMood.emoji}</div>

      <header className="topbar">
        <a className="brand" href="#top" aria-label="Tôi thèm mì cay, về đầu trang">
          <span className="brand-mark" aria-hidden="true"><span>🍜</span></span>
          <span className="brand-name">tôi thèm<br />mì cay</span>
        </a>
        <div className="spice-indicator"><span className="spice-dot" /> cơn thèm cấp độ 7</div>
      </header>

      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-kicker"><span className="kicker-line" /> một trang web rất cần thiết <span className="kicker-line" /></div>
        <h1 id="hero-title">tôi thèm <span>mì cay.</span></h1>
        <p className="hero-caption">Không có lý do. Chỉ là tự nhiên thèm thôi.</p>

        {!playerName ? (
          <form className="join-form" onSubmit={handleJoin}>
            <label className="join-label" htmlFor="player-name">Nhập tên để ghi danh hoặc vào lại</label>
            <div className="join-controls">
              <input
                id="player-name"
                type="text"
                value={draftName}
                onChange={(event) => { setDraftName(event.target.value); joinPlayer.reset(); }}
                placeholder="Tên của bạn là…"
                maxLength={24}
                autoComplete="nickname"
                aria-label="Tên người chơi"
                aria-describedby="join-message"
              />
              <button className="join-button" type="submit" disabled={joinPlayer.isPending}>
                {joinPlayer.isPending ? "Đang vào…" : "Vào chơi"}
                <span aria-hidden="true">↗</span>
              </button>
            </div>
            <p id="join-message" className={`join-hint ${nameError ? "is-error" : ""}`} aria-live="polite">
              {nameError || "Nhập tên cũ để giữ điểm · không cần mật khẩu."}
            </p>
          </form>
        ) : (
          <div className="player-welcome">
            <span className="welcome-avatar" aria-hidden="true">🍜</span>
            <span className="welcome-copy">đang chơi với tên <strong>{playerName}</strong>
              {burnedFingerUnlocked && <span className="secret-achievement-badge">🔥 Bỏng tay chưa?</span>}
              {antiClickAchievementUnlocked && <span className="secret-achievement-badge anti-click-achievement-badge">🤖 Nghẹn mất rồi</span>}
              {robotEaterUnlocked && <span className="secret-achievement-badge robot-eater-achievement-badge">🤖 robot ăn mì</span>}
            </span>
            <button type="button" onClick={leavePlayer} className="change-player">đổi tên</button>
          </div>
        )}

        <div className="button-stage">
          <div className="xp-gain-layer" aria-hidden="true">
            {xpGainPops.map((pop) => <span key={pop.id} className="xp-gain-pop" style={pop.style}>+1 XP</span>)}
          </div>
          <div className="burst-layer" aria-hidden="true">
            {particles.map((particle) => (
              <span key={particle.id} className="noodle-particle" style={particle.style}>{particle.emoji}</span>
            ))}
          </div>
          <button
            ref={noodleButtonRef}
            className={`noodle-button ${isHoldingNoodle ? "is-holding" : ""} ${isExploding ? "is-exploding" : ""}`}
            disabled={antiClickWarningOpen}
            onClick={makeItRain}
            onPointerDown={(event) => {
              if (event.pointerType === "mouse" && event.button !== 0) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              beginBurnerHold();
            }}
            onPointerUp={endBurnerHold}
            onPointerCancel={endBurnerHold}
            onLostPointerCapture={endBurnerHold}
            onKeyDown={(event) => {
              if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                event.preventDefault();
                beginBurnerHold();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                endBurnerHold();
                makeItRain();
              }
            }}
            onContextMenu={(event) => event.preventDefault()}
            aria-label={playerToken
              ? `Bấm để mì cay bay tung tóe; giữ ${SECRET_HOLD_DURATION_MS / 1000} giây để sạc ngọn lửa`
              : "Bấm để mì cay bay tung tóe; giữ để sạc ngọn lửa"}
          >
            {(isHoldingNoodle || isExploding) && (
              <span
                className={`hold-flame ${isExploding ? "is-exploding" : ""}`}
                aria-hidden="true"
                style={{ transform: `translateX(-50%) scale(${0.72 + holdProgress * 2.45})` }}
              >🔥</span>
            )}
            <span className="button-bowl" aria-hidden="true">🍜</span>
            <span>mì cay</span>
            <span className="button-spark" aria-hidden="true">✳</span>
          </button>
        </div>
        <div className="level-progress" aria-label="Tiến độ cấp mì cay">
          <div className="level-progress-heading">
            <strong className="level-name">🍜 mì cay cấp {levelProgress.level.toString()}</strong>
          </div>
          <div
            className="level-progress-track"
            role="progressbar"
            aria-label={`XP để lên cấp ${levelProgress.level.toString()}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={levelProgress.progressPercent}
          >
            <span className="level-progress-fill" style={{ transform: `scaleX(${levelProgress.progressPercent / 100})` }} />
            <span className="level-progress-value">
              {levelProgress.currentLevelExperience.toLocaleString("vi-VN")} / {levelProgress.experienceForNextLevel.toLocaleString("vi-VN")} XP
            </span>
          </div>
          <p className="level-progress-caption">
            Còn {levelProgress.experienceRemaining.toLocaleString("vi-VN")} XP lên cấp {(levelProgress.level + BigInt(1)).toString()}
          </p>
        </div>
        <div className="tiny-counter" aria-live="polite">
          <span className="counter-spark" aria-hidden="true">✳</span>
          {!playerToken
            ? "nhập tên, rồi bấm mì để lên BXH"
            : `Tổng: ${totalClicks.toLocaleString("vi-VN")} lần bấm`}
        </div>
        {notice && <p className="action-notice" role="status">{notice}</p>}

        <Dialog open={achievementDialogOpen} onOpenChange={setAchievementDialogOpen}>
          <DialogTrigger asChild>
            <button className="achievement-launch" type="button" aria-haspopup="dialog">
              <span aria-hidden="true">🏆</span>
              <span>Thành tựu</span>
              <span className="achievement-launch-tag" aria-label={`${unlockedAchievements.length} thành tựu đã nhận`}>{unlockedAchievements.length}</span>
            </button>
          </DialogTrigger>
          <DialogContent className="achievement-dialog">
            <DialogHeader className="achievement-dialog-header">
              <span className="achievement-dialog-icon" aria-hidden="true">🏆</span>
              <DialogTitle className="achievement-dialog-title">Bảng thành tựu</DialogTitle>
              <DialogDescription className="achievement-dialog-description">
                Một góc nhỏ để khoe những lần thèm mì đáng nhớ.
              </DialogDescription>
            </DialogHeader>
            <div className="achievement-tabs" role="tablist" aria-label="Chọn trang thành tựu">
              <button
                id="achievement-tab-achievements"
                className={`achievement-tab ${activeAchievementTab === "achievements" ? "is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={activeAchievementTab === "achievements"}
                aria-controls="achievement-panel"
                tabIndex={activeAchievementTab === "achievements" ? 0 : -1}
                onClick={() => setActiveAchievementTab("achievements")}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  setActiveAchievementTab("special");
                  document.getElementById("achievement-tab-special")?.focus();
                }}
              >
                Thành tựu
              </button>
              <button
                id="achievement-tab-special"
                className={`achievement-tab ${activeAchievementTab === "special" ? "is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={activeAchievementTab === "special"}
                aria-controls="achievement-panel"
                tabIndex={activeAchievementTab === "special" ? 0 : -1}
                onClick={() => setActiveAchievementTab("special")}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  setActiveAchievementTab("achievements");
                  document.getElementById("achievement-tab-achievements")?.focus();
                }}
              >
                Đặc biệt
              </button>
            </div>
            <div
              id="achievement-panel"
              className="achievement-panel"
              role="tabpanel"
              aria-labelledby={`achievement-tab-${activeAchievementTab}`}
              tabIndex={0}
            >
              {visibleAchievements.length === 0 ? (
                <section className="achievement-empty-state" aria-live="polite">
                  <span className="achievement-empty-illustration" aria-hidden="true">
                    {activeAchievementTab === "achievements" ? "🍜✨" : "✨"}
                  </span>
                  <h3>
                    {activeAchievementTab === "achievements"
                      ? "Chưa có thành tựu nào"
                      : "Chưa mở khóa thành tựu đặc biệt nào"}
                  </h3>
                  <span className="achievement-coming-soon">
                    {activeAchievementTab === "achievements" ? "ĐANG ĐƯỢC NẤU" : "ĐANG ĐƯỢC GIẤU KÍN"}
                  </span>
                </section>
              ) : (
                <div className="achievement-list" role="list">
                  {visibleAchievements.map((achievement) => (
                    <article className="achievement-item" key={achievement.id} role="listitem">
                      <span aria-hidden="true">{achievement.icon}</span>
                      <div>
                        <h3>{achievement.title}</h3>
                        <p>{achievement.description}</p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

        <div className="mood-picker" aria-label="Chọn vị mì cay">
          <p className="picker-label">hôm nay thèm vị nào?</p>
          <div className="mood-options" role="group" aria-label="Chọn topping nền">
            {moods.map((item) => (
              <button
                key={item.id}
                className={`mood-option ${mood === item.id ? "is-active" : ""}`}
                onClick={() => setMood(item.id)}
                aria-pressed={mood === item.id}
              >
                <span className="mood-emoji" aria-hidden="true">{item.emoji}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <p className="mood-note" aria-live="polite">{activeMood.note} · cay 7 cấp</p>
        </div>
      </section>

      <section className="leaderboard-wrap" aria-labelledby="leaderboard-title">
        <div className="leaderboard-card">
          <div className="leaderboard-heading">
            <div>
              <p className="leaderboard-eyebrow"><span className="rank-spark">✳</span> BẢNG XẾP HẠNG</p>
              <h2 id="leaderboard-title">Ai thèm mì nhất?</h2>
            </div>
            <div className="leaderboard-header-actions">
              <span className="live-tag"><span className="live-dot" /> cập nhật liên tục</span>
              <button
                className="leaderboard-refresh"
                type="button"
                onClick={refreshLeaderboard}
                disabled={leaderboard.isFetching}
                aria-label={leaderboard.isFetching ? "Đang tải lại bảng xếp hạng" : `Tải lại BXH ${activeBoardLabel}`}
                title={`Tải lại BXH ${activeBoardLabel}`}
              >
                <RefreshCw size={14} aria-hidden="true" className={leaderboard.isFetching ? "is-spinning" : ""} />
              </button>
            </div>
          </div>
          <div className="leaderboard-tabs" role="tablist" aria-label="Chọn bảng xếp hạng">
            {boards.map((board) => (
              <button
                key={board.id}
                type="button"
                role="tab"
                aria-selected={activeBoard === board.id}
                className={`leaderboard-tab ${activeBoard === board.id ? "is-active" : ""}`}
                onClick={() => dispatchBoard({ type: "select", board: board.id })}
              >
                <span aria-hidden="true">{board.emoji}</span>
                <span>{board.label}</span>
              </button>
            ))}
          </div>
          {leaderboardError ? (
            <div className="leaderboard-empty" role="status">
              <span aria-hidden="true">🍜</span>
              <p>BXH đang nghỉ ăn mì một chút.</p>
              <button type="button" onClick={() => void leaderboard.refetch()}>Thử tải lại</button>
            </div>
          ) : leaderboard.isLoading ? (
            <div className="leaderboard-empty" role="status"><span aria-hidden="true">🥢</span><p>Đang đếm mì…</p></div>
          ) : !leaderboard.data?.top.length ? (
            <div className="leaderboard-empty">
              <span aria-hidden="true">🍜</span>
              <p>{activeBoard === "total" ? "Chưa ai ghi danh cả. Mở hàng đi nào!" : "Chưa ai bấm vị này cả. Mở hàng đi nào!"}</p>
            </div>
          ) : (
            <ol className="leaderboard-list" role="tabpanel" aria-label={`BXH ${activeBoardLabel}`}>
              {leaderboard.data.top.map((entry, index) => {
                const rank = index + 1;
                const isMe = entry.playerId === leaderboard.data?.me?.playerId;
                return (
                  <li key={entry.playerId} className={`leaderboard-row ${rank <= 3 ? `top-rank rank-${rank}` : ""} ${isMe ? "is-me" : ""}`}>
                    <span className="rank-number" aria-label={`Hạng ${rank}`}>{medalFor(rank)}</span>
                    <span className="rank-avatar" aria-hidden="true">{rank === 1 ? "👑" : "🍜"}</span>
                    <span className="rank-name">
                      {entry.robotIconActive && <span className="rank-robot-icon" title="Icon robot hết hạn lúc 0 giờ hôm sau" aria-label="Icon robot">🤖</span>}
                      {entry.name}{isMe && <span className="you-tag">BẠN</span>}
                    </span>
                    <span className="rank-score">{entry.score.toLocaleString("vi-VN")} <small>lần bấm</small></span>
                  </li>
                );
              })}
              {leaderboard.data.me && !leaderboard.data.top.some((entry) => entry.playerId === leaderboard.data?.me?.playerId) && (
                <li className="leaderboard-row is-me outside-top">
                  <span className="rank-number">{leaderboard.data.me.rank}</span>
                  <span className="rank-avatar" aria-hidden="true">🍜</span>
                  <span className="rank-name">
                    {leaderboard.data.me.robotIconActive && <span className="rank-robot-icon" title="Icon robot hết hạn lúc 0 giờ hôm sau" aria-label="Icon robot">🤖</span>}
                    {leaderboard.data.me.name}<span className="you-tag">BẠN</span>
                  </span>
                  <span className="rank-score">{leaderboard.data.me.score.toLocaleString("vi-VN")} <small>lần bấm</small></span>
                </li>
              )}
            </ol>
          )}
          <div className="leaderboard-footnote"><span>🏆</span> Mỗi lần bấm mì cay = 1 điểm ở vị đã chọn và 1 điểm tổng.</div>
        </div>
      </section>

      <footer className="bottom-note"><span>MI CAY CLUB</span><span className="footer-asterisk">✳</span><span>hết thèm thì thôi</span><span className="footer-version">b1.2</span></footer>
    </main>
  );
}

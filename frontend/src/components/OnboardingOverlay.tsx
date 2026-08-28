import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import {placeCallout, type Rect} from '../onboarding/placeCallout'
import {DemoBulk, DemoGrouped, DemoOrganize} from '../onboarding/panels'
import {
  nextOnboardingStep,
  onboardingCalloutPrefer,
  onboardingCopy,
  onboardingDemo,
  onboardingTarget,
  type OnboardingStep,
} from '../onboarding/steps'

type Props = {
  onFinish: () => void
}

const SPOT_PAD = 6

function measureTarget(id: string): Rect | null {
  const el = document.querySelector(`[data-tour="${id}"]`)
  if (!(el instanceof HTMLElement)) return null
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return null
  return {
    top: r.top - SPOT_PAD,
    left: r.left - SPOT_PAD,
    width: r.width + SPOT_PAD * 2,
    height: r.height + SPOT_PAD * 2,
  }
}

export default function OnboardingOverlay({onFinish}: Props) {
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [hole, setHole] = useState<Rect | null>(null)
  const [cardPos, setCardPos] = useState({top: 80, left: 80})
  const cardRef = useRef<HTMLDivElement>(null)
  const copy = onboardingCopy(step)
  const demo = onboardingDemo(step)
  const target = onboardingTarget(step)

  const syncLayout = useCallback(() => {
    const nextHole = target ? measureTarget(target) : null
    setHole(nextHole)
    const cardBox = cardRef.current?.getBoundingClientRect()
    const cardSize = cardBox
      ? {width: cardBox.width, height: cardBox.height}
      : {width: 320, height: 180}
    const viewport = {width: window.innerWidth, height: window.innerHeight}
    if (step === 'done' && !nextHole) {
      setCardPos({
        top: Math.max(12, viewport.height - cardSize.height - 24),
        left: Math.max(12, viewport.width - cardSize.width - 24),
      })
      return
    }
    setCardPos(
      placeCallout(nextHole, cardSize, viewport, 12, onboardingCalloutPrefer(step)),
    )
  }, [target, step])

  useLayoutEffect(() => {
    syncLayout()
  }, [syncLayout, step, demo.organize, demo.previewFilled, demo.executed, demo.report, demo.bulk, demo.grouped])

  useEffect(() => {
    const onResize = () => syncLayout()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [syncLayout])

  useEffect(() => {
    const id = window.setTimeout(syncLayout, 0)
    return () => window.clearTimeout(id)
  }, [syncLayout, step])

  useEffect(() => {
    if (copy.primary) {
      cardRef.current?.querySelector<HTMLButtonElement>('.onboarding-card-primary')?.focus()
      return
    }
    document.querySelector<HTMLButtonElement>('.onboarding-hit')?.focus()
  }, [step, copy.primary])

  function advance() {
    const next = nextOnboardingStep(step)
    if (!next) {
      onFinish()
      return
    }
    setStep(next)
  }

  function onHotspotActivate() {
    if (step === 'welcome' || step === 'done') return
    advance()
  }

  return (
    <div className="onboarding-root" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
      {demo.organize ? (
        <DemoOrganize
          previewFilled={demo.previewFilled}
          executed={demo.executed}
          report={demo.report}
        />
      ) : null}
      {demo.bulk ? <DemoBulk step={demo.bulkStep} /> : null}
      {demo.grouped ? <DemoGrouped /> : null}

      <div
        className={hole ? 'onboarding-catcher has-spot' : 'onboarding-catcher'}
        onPointerDown={(e) => e.preventDefault()}
        onWheel={(e) => e.preventDefault()}
      />
      {hole ? (
        <div
          className="onboarding-spot"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
          }}
        />
      ) : null}
      {hole ? (
        <button
          type="button"
          className="onboarding-hit"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
          }}
          aria-label={copy.title}
          onClick={onHotspotActivate}
        />
      ) : null}

      <div
        ref={cardRef}
        className="onboarding-card"
        style={{top: cardPos.top, left: cardPos.left}}
      >
        <p className="onboarding-kicker">新手引导</p>
        <h2 id="onboarding-title">{copy.title}</h2>
        <p>{copy.body}</p>
        <div className="onboarding-card-actions">
          {step !== 'done' ? (
            <button type="button" className="btn onboarding-skip" onClick={onFinish}>
              跳过引导
            </button>
          ) : null}
          {copy.primary ? (
            <button
              type="button"
              className="btn btn-primary onboarding-card-primary"
              onClick={advance}
            >
              {copy.primary}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

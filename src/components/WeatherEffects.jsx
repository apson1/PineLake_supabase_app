import { useEffect, useRef } from "react"

export default function WeatherEffects({ weather }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")

    let animationId
    let width = (canvas.width = window.innerWidth)
    let height = (canvas.height = window.innerHeight)

    // Handle resize
    const handleResize = () => {
      width = canvas.width = window.innerWidth
      height = canvas.height = window.innerHeight
    }
    window.addEventListener("resize", handleResize)

    // Particle Classes
    class RainDrop {
      constructor() {
        this.reset()
      }
      reset() {
        this.x = Math.random() * width
        this.y = Math.random() * -height
        this.vy = 12 + Math.random() * 8
        this.vx = (weather?.wind || 0) * 0.15 + (Math.random() - 0.5) * 0.5
        this.len = 10 + Math.random() * 10
        this.opacity = 0.15 + Math.random() * 0.2
      }
      update() {
        this.x += this.vx
        this.y += this.vy
        if (this.y > height || this.x < -20 || this.x > width + 20) {
          this.reset()
        }
      }
      draw() {
        ctx.strokeStyle = `rgba(126, 200, 227, ${this.opacity})`
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(this.x, this.y)
        ctx.lineTo(this.x + this.vx * 0.5, this.y + this.len)
        ctx.stroke()
      }
    }

    class WindLine {
      constructor() {
        this.reset()
      }
      reset() {
        this.x = Math.random() * -width
        this.y = Math.random() * height
        this.vx = 2 + (weather?.wind || 0) * 0.35 + Math.random() * 2
        this.len = 80 + Math.random() * 120
        this.opacity = 0.03 + Math.random() * 0.05
      }
      update() {
        this.x += this.vx
        if (this.x > width) {
          this.reset()
        }
      }
      draw() {
        ctx.strokeStyle = `rgba(255, 255, 255, ${this.opacity})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(this.x, this.y)
        ctx.bezierCurveTo(
          this.x + this.len * 0.25, this.y - 10,
          this.x + this.len * 0.75, this.y + 10,
          this.x + this.len, this.y
        )
        ctx.stroke()
      }
    }

    // Initialize arrays
    const isRainy = weather?.text?.toLowerCase().includes("rain") || 
                    weather?.text?.toLowerCase().includes("shower") ||
                    (weather?.code >= 51 && weather?.code <= 82)
    const isWindy = (weather?.wind || 0) > 10
    const isSunny = weather?.text?.toLowerCase().includes("sunny") || weather?.code === 0

    const rainDrops = []
    if (isRainy) {
      const count = Math.min(120, Math.floor(width / 12))
      for (let i = 0; i < count; i++) rainDrops.push(new RainDrop())
    }

    const windLines = []
    if (isWindy) {
      const count = Math.min(25, Math.floor(width / 80))
      for (let i = 0; i < count; i++) windLines.push(new WindLine())
    }

    let sunAngle = 0

    // Animation loop
    const animate = () => {
      ctx.clearRect(0, 0, width, height)

      // Draw sunbeams if sunny
      if (isSunny) {
        sunAngle += 0.003
        const numBeams = 6
        const centerX = width - 30
        const centerY = 30
        const beamLen = 220
        
        ctx.fillStyle = "rgba(252, 163, 17, 0.015)"
        ctx.beginPath()
        ctx.arc(centerX, centerY, 80, 0, 2 * Math.PI)
        ctx.fill()

        for (let i = 0; i < numBeams; i++) {
          const angle = sunAngle + (i * Math.PI) / numBeams
          const opacity = 0.012 + Math.sin(sunAngle * 3 + i) * 0.005
          
          ctx.fillStyle = `rgba(252, 163, 17, ${opacity})`
          ctx.beginPath()
          ctx.moveTo(centerX, centerY)
          ctx.lineTo(
            centerX + Math.cos(angle - 0.08) * beamLen,
            centerY + Math.sin(angle - 0.08) * beamLen
          )
          ctx.lineTo(
            centerX + Math.cos(angle + 0.08) * beamLen,
            centerY + Math.sin(angle + 0.08) * beamLen
          )
          ctx.closePath()
          ctx.fill()
        }
      }

      // Update & Draw Wind
      windLines.forEach((line) => {
        line.update()
        line.draw()
      })

      // Update & Draw Rain
      rainDrops.forEach((drop) => {
        drop.update()
        drop.draw()
      })

      animationId = requestAnimationFrame(animate)
    }

    animate()

    // Cleanup
    return () => {
      cancelAnimationFrame(animationId)
      window.removeEventListener("resize", handleResize)
    }
  }, [weather])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.8 }}
    />
  )
}

# Guía para Implementar Wheel y Plinko UI

> **Nota:** Esta guía asume que ya tenés el contrato deployado (es un copy-paste del nuestro). 
> No usa Worldcoin MiniKit - usá viem/wagmi directamente para las transacciones.

---

## Arquitectura General

Ambos juegos siguen el mismo patrón mental:

```
STORE (Zustand) ←→ COMPONENTE PRINCIPAL ←→ ANIMACIÓN (GSAP)
       ↓                                          ↓
  web3Client                              SVG que se anima
  (lectura de contrato)                   (rueda o tablero)
```

**El secreto:** La animación y la blockchain están desacopladas. La animación es "cosmética" - el resultado REAL viene del contrato. Vos solo tenés que hacer que la animación termine donde el contrato dice que terminó.

---

## Estados del Juego

Ambos juegos tienen este flujo de estados:

```
IDLE → WAITING_TX → ANIMANDO → MOSTRANDO_RESULTADO → IDLE
```

1. **IDLE**: Usuario puede cambiar bet amount, hacer click en SPIN/PLAY
2. **WAITING_TX**: Transacción enviada, esperando confirmación
3. **ANIMANDO**: Tx confirmada, animación corriendo
4. **MOSTRANDO_RESULTADO**: Animación terminó, modal con WIN/LOSE

---

## Flujo de una Apuesta (Paso a Paso)

### 1. Antes de la TX
- Guardar snapshot de `pendingBetIds` del jugador (del contrato)
- Esto es CLAVE para después saber cuál es el betId nuevo

### 2. Enviar TX
- Llamar a `payAndPlayStandard` en el Router
- Necesitás encodear el `gameChoice` con: configId, betCount, stopGain, stopLoss

### 3. Mientras espera confirmación
- **Wheel:** Empezar spin infinito (la rueda gira y gira)
- **Plinko:** Mostrar estado "Confirming..." en el botón

### 4. TX Confirmada
- Comparar `pendingBetIds` de ANTES vs AHORA
- El betId nuevo es la diferencia
- Llamar a tu backend para hacer el SETTLE (el backend tiene la private key del operator)

### 5. Settle Confirmado
- Leer resultado del contrato con `getBetResult(betId)` o `getBetRolls(betId)`
- El contrato te dice: segmento ganador, multiplicador, payout, win/lose

### 6. Animar al Resultado
- **Wheel:** Detener spin infinito, animar hacia el segmento ganador
- **Plinko:** Usar los buckets del resultado para calcular los paths de las bolas

### 7. Mostrar Modal
- Cuando la animación termina, mostrar WIN/LOSE con el payout

---

## WHEEL - Consejos Específicos

### La Rueda (SVG)
- Es un SVG con segmentos generados matemáticamente (arcos)
- El grupo `<g id="wheel">` es lo que GSAP rota
- El centro es ESTÁTICO (no rota) - tiene el logo/imagen

### Animación
- **Spin infinito:** `gsap.to('#wheel', { rotation: '+=21600', duration: 30, repeat: -1, ease: 'none' })`
- **Spin al resultado:** Calcular rotación final para que el segmento ganador quede arriba
- La fórmula: `rotaciónFinal = rotaciónActual + (5 vueltas extra) + ánguloDelSegmento`
- Usar `ease: 'power3.out'` para que desacelere naturalmente

### Tips
- El pointer/flecha es ESTÁTICO, la rueda gira debajo
- Agregar sonido de "tick" que se dispara cada vez que pasa un segmento
- Las luces marquee alrededor son puro CSS animation

---

## PLINKO - Consejos Específicos (Lo más importante)

### Concepto Clave
El Plinko es "determinístico disfrazado de aleatorio". El contrato te dice en qué bucket(s) cayó la bola. Vos tenés que animar un path que TERMINE en ese bucket, pero que PAREZCA aleatorio.

### El Path Calculator
Esta es la parte más importante:

1. **Input:** bucket destino (0-12 por ejemplo)
2. **Output:** array de posiciones (x,y) por donde pasa la bola

**La lógica:**
- Hay N filas de pins
- En cada fila, la bola puede ir IZQUIERDA o DERECHA
- El bucket final = cantidad de veces que fue a la derecha
- Si el bucket destino es 7, necesitás exactamente 7 movimientos "derecha"

**El truco:**
- Crear array con la cantidad correcta de izquierdas y derechas
- MEZCLAR aleatoriamente (Fisher-Yates shuffle)
- Esto garantiza que termina en el bucket correcto pero con path diferente cada vez

### Multi-Ball (Varias bolas)
Cuando el usuario apuesta con betCount > 1, el contrato devuelve un array de buckets (uno por bola).

**Timing de las bolas:**
1. Primera bola empieza a caer
2. Cuando la primera bola TOCA EL PRIMER PIN, la segunda empieza
3. Esto crea efecto de cascada muy satisfactorio
4. Usar callback `onHitFirstPin` en la animación

### Animación de Cada Bola
- Caída vertical hasta el primer pin (gravity feel)
- Después: arcos parabólicos entre pins (bezier cuadrático)
- La velocidad AUMENTA conforme baja (aceleración por gravedad)
- Bounce pequeño al llegar al bucket

### El Tablero (SVG)
- Pins: círculos pequeños en patrón triangular
- Buckets: rectángulos con el multiplicador
- Bolas: círculos con `opacity: 0` que se muestran al animar
- Usar colores diferentes para cada bola si hay varias

### Tips Importantes
1. **Pre-renderizar las bolas:** Crear N elementos `<circle>` ocultos, no crear/destruir dinámicamente
2. **GSAP Timeline:** Usar timeline para cada bola, permite control preciso
3. **Highlight del bucket:** Cuando la bola llega, hacer flash/pulse en el bucket
4. **Sonido:** "Tink" cada vez que toca un pin, "Ding" al llegar al bucket

---

## Lectura del Contrato

### Funciones que necesitás implementar:

| Función | Qué devuelve | Cuándo usarla |
|---------|--------------|---------------|
| `getWheelConfig(configId)` | segments, multipliers[] | Al montar, para saber cuántos segmentos |
| `getTokenConfig(tokenAddress)` | minBet, maxBet, allowed | Para validar apuestas |
| `getPlayerInfo(address)` | pendingBetIds[] | ANTES y DESPUÉS de la tx para detectar betId |
| `getBetResult(betId)` | win, segment, payout | Para Wheel después del settle |
| `getBetRolls(betId)` | rolled[], multipliers[] | Para Plinko multi-ball |

---

## Estructura de Carpetas Recomendada

```
components/
├── Wheel/
│   ├── index.tsx              # Componente principal
│   ├── store/
│   │   └── useWheelStore.ts   # Estado con Zustand
│   ├── WheelSVG.tsx           # El SVG de la rueda
│   ├── WheelAnimation.ts      # Funciones GSAP
│   └── WheelResultModal.tsx   # Modal de resultado
│
├── Plinko/
│   ├── index.tsx
│   ├── store/
│   │   └── usePlinkoStore.ts
│   ├── PlinkoBoard.tsx        # SVG del tablero
│   ├── utils/
│   │   ├── pathCalculator.ts  # Genera paths a los buckets
│   │   └── PlinkoAnimation.ts # Animación de bolas
│   └── PlinkoResultModal.tsx
│
└── utils/
    └── web3Client.ts          # Todas las llamadas al contrato
```

---

## Dependencias Necesarias

- **gsap** - Para las animaciones (es el standard, muy confiable)
- **zustand** - State management simple y efectivo
- **ethers** o **viem** - Para leer el contrato
- **framer-motion** (opcional) - Para animaciones de UI/modales

---

## Errores Comunes a Evitar

### Wheel
1. ❌ Calcular mal el ángulo final → la rueda para en el segmento incorrecto
2. ❌ No matar la animación infinita antes de animar al resultado → conflicto de tweens
3. ❌ Olvidar `transformOrigin: 'center center'` → la rueda rota desde una esquina

### Plinko
1. ❌ No clampear la posición del pin → bola intenta ir a un pin que no existe en esa fila
2. ❌ Empezar todas las bolas al mismo tiempo → se ven superpuestas y feo
3. ❌ Path con cantidad incorrecta de izq/der → bola termina en bucket equivocado
4. ❌ No usar `will-change: transform` en las bolas → animación lagueada

---

## Checklist Final

### Wheel
- [ ] Rueda gira infinito mientras espera tx
- [ ] Rueda para en el segmento correcto
- [ ] Centro no rota
- [ ] Sonido de tick al pasar segmentos
- [ ] Modal muestra multiplicador y payout

### Plinko
- [ ] Path calculator garantiza bucket correcto
- [ ] Bolas empiezan escalonadas (no todas juntas)
- [ ] Velocidad aumenta conforme baja
- [ ] Buckets se iluminan al recibir bola
- [ ] Resultado final suma todos los payouts

---

## Colores del Theme (para consistencia)

```
Cyan:     #07eafd
Magenta:  #c914dd
Fondo:    #0a0a0f
```

El gradiente característico: `linear-gradient(90deg, #07eafd, #c914dd)`

---

¿Preguntas? El código de referencia está en los componentes Wheel/ y Plinko/ de este repo.

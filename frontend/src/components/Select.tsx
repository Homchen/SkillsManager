import {
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  useState,
  useRef,
  useEffect,
  useId,
  useCallback,
} from 'react'
import { IconChevronDown, IconCheck } from './icons'
import { computeSelectAlignment, getNextSelectIndex } from '../lib/selectHelpers'

export interface SelectOption<T extends string | number = string> {
  value: T
  label: ReactNode
  description?: ReactNode
  icon?: ReactNode
  badge?: ReactNode
  disabled?: boolean
  title?: string
}

export interface SelectProps<T extends string | number = string> {
  value: T
  onChange: (value: T) => void
  options: SelectOption<T>[]
  placeholder?: string
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  variant?: 'default' | 'filter' | 'ghost'
  prefixIcon?: ReactNode
  className?: string
  triggerClassName?: string
  menuClassName?: string
  optionClassName?: string
  ariaLabel?: string
  title?: string
  align?: 'left' | 'right' | 'auto'
  width?: string | number
  minMenuWidth?: string | number
  maxMenuHeight?: number
  renderOption?: (option: SelectOption<T>, isSelected: boolean) => ReactNode
  renderValue?: (option?: SelectOption<T>) => ReactNode
}

export function Select<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder = '请选择',
  disabled = false,
  size = 'md',
  variant = 'default',
  prefixIcon,
  className = '',
  triggerClassName = '',
  menuClassName = '',
  optionClassName = '',
  ariaLabel,
  title,
  align = 'auto',
  width,
  minMenuWidth,
  maxMenuHeight,
  renderOption,
  renderValue,
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const [computedAlign, setComputedAlign] = useState<'left' | 'right'>('left')

  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const optionRefs = useRef<(HTMLLIElement | null)[]>([])

  const id = useId()
  const listboxId = `select-listbox-${id}`

  const selectedIndex = options.findIndex((opt) => opt.value === value)
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined

  // Determine alignment when menu opens
  const updateAlignment = useCallback(() => {
    if (align !== 'auto') {
      setComputedAlign(align)
      return
    }
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    setComputedAlign(computeSelectAlignment(rect, window.innerWidth, 200))
  }, [align])

  const openMenu = useCallback(() => {
    if (disabled) return
    updateAlignment()
    setIsOpen(true)
    setFocusedIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }, [disabled, updateAlignment, selectedIndex])

  const closeMenu = useCallback(() => {
    setIsOpen(false)
    setFocusedIndex(-1)
  }, [])

  const toggleMenu = useCallback(() => {
    if (disabled) return
    if (isOpen) {
      closeMenu()
    } else {
      openMenu()
    }
  }, [disabled, isOpen, closeMenu, openMenu])

  const selectOption = useCallback(
    (opt: SelectOption<T>) => {
      if (opt.disabled) return
      onChange(opt.value)
      closeMenu()
      triggerRef.current?.focus()
    },
    [onChange, closeMenu],
  )

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }

    document.addEventListener('mousedown', handleClickOutside, true)
    document.addEventListener('touchstart', handleClickOutside, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true)
      document.removeEventListener('touchstart', handleClickOutside, true)
    }
  }, [isOpen, closeMenu])

  // Scroll focused option into view
  useEffect(() => {
    if (isOpen && focusedIndex >= 0 && optionRefs.current[focusedIndex]) {
      optionRefs.current[focusedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      })
    }
  }, [isOpen, focusedIndex])

  const handleKeyDown = (e: ReactKeyboardEvent) => {
    if (disabled) return

    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openMenu()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const next = getNextSelectIndex(focusedIndex, options, 'next')
        if (next >= 0) setFocusedIndex(next)
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prev = getNextSelectIndex(focusedIndex, options, 'prev')
        if (prev >= 0) setFocusedIndex(prev)
        break
      }
      case 'Home': {
        e.preventDefault()
        const first = getNextSelectIndex(focusedIndex, options, 'first')
        if (first >= 0) setFocusedIndex(first)
        break
      }
      case 'End': {
        e.preventDefault()
        const last = getNextSelectIndex(focusedIndex, options, 'last')
        if (last >= 0) setFocusedIndex(last)
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < options.length) {
          const opt = options[focusedIndex]
          if (!opt.disabled) {
            selectOption(opt)
          }
        }
        break
      }
      case 'Escape': {
        e.preventDefault()
        closeMenu()
        triggerRef.current?.focus()
        break
      }
      case 'Tab': {
        closeMenu()
        break
      }
    }
  }

  // Active option id for aria-activedescendant
  const activeDescendantId =
    isOpen && focusedIndex >= 0 ? `${listboxId}-option-${focusedIndex}` : undefined

  return (
    <div
      ref={containerRef}
      className={`custom-select custom-select-${size} custom-select-${variant} ${isOpen ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}
      style={width ? { width } : undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-activedescendant={activeDescendantId}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        className={`custom-select-trigger ${triggerClassName}`.trim()}
        onClick={toggleMenu}
        onKeyDown={handleKeyDown}
      >
        <span className="custom-select-trigger-content">
          {prefixIcon ? <span className="custom-select-prefix">{prefixIcon}</span> : null}
          <span className="custom-select-value">
            {renderValue
              ? renderValue(selectedOption)
              : (selectedOption?.label ?? placeholder)}
          </span>
        </span>
        <span className={`custom-select-arrow ${isOpen ? 'is-expanded' : ''}`} aria-hidden="true">
          <IconChevronDown size={size === 'sm' ? 12 : 14} />
        </span>
      </button>

      {isOpen && (
        <ul
          ref={menuRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          className={`custom-select-menu align-${computedAlign} ${menuClassName}`.trim()}
          style={{
            minWidth: minMenuWidth ?? '100%',
            maxHeight: maxMenuHeight ? `${maxMenuHeight}px` : undefined,
          }}
        >
          {options.length === 0 ? (
            <li className="custom-select-empty" role="presentation">
              无可用选项
            </li>
          ) : (
            options.map((option, idx) => {
              const isSelected = option.value === value
              const isFocused = idx === focusedIndex
              const optionId = `${listboxId}-option-${idx}`

              return (
                <li
                  key={String(option.value)}
                  id={optionId}
                  ref={(el) => {
                    optionRefs.current[idx] = el
                  }}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled}
                  title={option.title}
                  className={`custom-select-option ${isSelected ? 'is-selected' : ''} ${isFocused ? 'is-focused' : ''} ${option.disabled ? 'is-disabled' : ''} ${optionClassName}`.trim()}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => {
                    if (!option.disabled) {
                      setFocusedIndex(idx)
                    }
                  }}
                >
                  {renderOption ? (
                    renderOption(option, isSelected)
                  ) : (
                    <>
                      <div className="custom-select-option-main">
                        {option.icon ? (
                          <span className="custom-select-option-icon">{option.icon}</span>
                        ) : null}
                        <div className="custom-select-option-texts">
                          <span className="custom-select-option-label">{option.label}</span>
                          {option.description ? (
                            <span className="custom-select-option-desc">
                              {option.description}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="custom-select-option-side">
                        {option.badge ? (
                          <span className="custom-select-option-badge">{option.badge}</span>
                        ) : null}
                        {isSelected ? (
                          <span className="custom-select-option-check" aria-hidden="true">
                            <IconCheck size={size === 'sm' ? 12 : 14} />
                          </span>
                        ) : null}
                      </div>
                    </>
                  )}
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}

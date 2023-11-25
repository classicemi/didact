const isEvent = key => key.startsWith('on')
const isProperty = key => key !== 'children' && !isEvent(key)

// 生成普通节点虚拟dom
function createElement(type, props, ...children) {
  return {
    type,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child)
      ),
    },
  }
}

// 生成文字节点虚拟dom
function createTextElement(text) {
  return {
    type: "TEXT_ELEMENT",
    props: {
      nodeValue: text,
      children: [],
    },
  }
}

// 生成实际dom
// fiber看作一个虚拟dom节点
function createDom(fiber) {
  const dom = fiber.type === 'TEXT_ELEMENT'
    ? document.createTextNode('')
    : document.createElement(fiber.type)

  Object.keys(fiber.props)
    .filter(isProperty)
    .forEach(name => {
      dom[name] = fiber.props[name]
    })

  // 添加事件监听
  Object.keys(fiber.props)
    .filter(isEvent)
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2)
      dom.addEventListener(eventType, fiber.props[name])
    })
  
  return dom
}

// 将fiber树节点添加到dom
function commitRoot() {
  // 先遍历要删除的节点列表，执行删除
  deletions.forEach(commitWork)
  commitWork(wipRoot.child)
  // commit完成后更新currentRoot
  currentRoot = wipRoot
  wipRoot = null
}

// 比较新旧两个fiber的props
const isNew = (prev, next) => key =>
  prev[key] !== next[key]
const isGone = (prev, next) => key => !(key in next)
function updateDom(dom, prevProps, nextProps) {
  // 移除旧的或被修改的事件监听
  Object.keys(prevProps)
    .filter(isEvent)
    .filter(
      key =>
        !(key in nextProps) ||
        isNew(prevProps, nextProps)(key)
    )
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2)
      dom.removeEventListener(eventType, prevProps[name])
    })

  // 筛选出要被移除的prop
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone(prevProps, nextProps))
    .forEach(name => {
      dom[name] = ''
    })
  
  // 设置新的或要修改的prop
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      dom[name] = nextProps[name]
    })
  
  // 添加新的事件监听
  Object.keys(nextProps)
    .filter(isEvent)
    .filter(isNew(prevProps, nextProps))
    .forEach(name => {
      const eventType = name.toLowerCase().substring(2)
      dom.addEventListener(eventType, nextProps[name])
    })
}

function commitWork(fiber) {
  if (!fiber) {
    return
  }
  // 使用函数组件时，有的fiber会没有dom（那些type为函数的fiber）
  // 给domParentFiber赋值后进行检测，如果该fiber没有dom，说明这是一个type为函数的fiber，不能作为实际的parent
  // 要向上查找，直到找到有真实dom的fiber
  let domParentFiber = fiber.parent
  while (!domParentFiber.dom) {
    domParentFiber = domParentFiber.parent
  }
  const domParent = domParentFiber.dom

  // 校验effectTag属性，如果是PLACEMENT表示新增
  if (
    fiber.effectTag === 'PLACEMENT' &&
    fiber.dom != null
  ) {
    domParent.appendChild(fiber.dom)
  } else if (
    fiber.effectTag === 'UPDATE' &&
    fiber.dom != null
  ) {
    updateDom(
      fiber.dom,
      fiber.alternate.props,
      fiber.props,
    )
  } else if (fiber.effectTag === 'DELETION') {
    // 由于当前fiber可能不包含真实dom，需要向下查找到第一个有真实dom的fiber
    commitDeletion(fiber, domParent)
  }

  commitWork(fiber.child)
  commitWork(fiber.sibling)
}

function commitDeletion(fiber, domParent) {
  if (fiber.dom) {
    domParent.removeChild(fiber.dom)
  } else {
    commitDeletion(fiber.child, domParent)
  }
}

function render(element, container) {
  wipRoot = {
    dom: container,
    props: {
      children: [element],
    },
    // 在新的fiber树中添加指向前一个fiber树的指针
    alternate: currentRoot,
  }
  deletions = []
  nextUnitOfWork = wipRoot
}

// 该指针用于指向下一个fiber任务
let nextUnitOfWork = null
// 用于保存前一次commit的fiber树根节点
let currentRoot = null
// 用该指针保留fiber树的根节点引用
let wipRoot = null
// 用于保存要被移除的节点，在render新的fiber树时，新fiber树中没有要删除的节点
// 所以需要用一个数组保存要删除的节点
let deletions = null

function workLoop(deadline) {
  let shouldYield = false
  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork)
    shouldYield = deadline.timeRemaining() < 1
  }

  // 在任务全部完成后，一次将完整fiber树的dom节点创建出来
  if (!nextUnitOfWork && wipRoot) {
    commitRoot()
  }

  requestIdleCallback(workLoop)
}

requestIdleCallback(workLoop)

function performUnitOfWork(fiber) {
  // 函数组件的type是一个函数
  const isFunctionComponent =
    fiber.type instanceof Function
  if (isFunctionComponent) {
    updateFunctionComponent(fiber)
  } else {
    updateHostComponent(fiber)
  }

  // 搜索下一个任务，先查找子fiber，再查找下一个兄弟fiber，最后查找叔叔fiber
  if (fiber.child) {
    return fiber.child
  }
  let nextFiber = fiber
  while (nextFiber) {
    if (nextFiber.sibling) {
      return nextFiber.sibling
    }
    nextFiber = nextFiber.parent
  }
}

let wipFiber = null
let hookIndex = null

// 更新函数组件fiber
function updateFunctionComponent(fiber) {
  wipFiber = fiber
  hookIndex = 0
  wipFiber.hooks = []
  const children = [fiber.type(fiber.props)]
  reconcileChildren(fiber, children)
}

function useState(initial) {
  const oldHook =
    wipFiber.alternate &&
    wipFiber.alternate.hooks &&
    wipFiber.alternate.hooks[hookIndex]
  const hook = {
    state: oldHook ? oldHook.state : initial,
    queue: [],
  }

  // 下次更新组件时，执行这段代码，如果oldHook的任务队列有任务，则依次执行
  const actions = oldHook ? oldHook.queue : []
  actions.forEach(action => {
    hook.state = action(hook.state)
  })

  // 这里只实现了在setState里传入函数
  const setState = action => {
    // 每次调用setState时，将要执行的action加入当前hook的队列
    // 并给wipRoot和nextUnitOfWork赋值，下次执行requestIdleCallback时会触发更新
    hook.queue.push(action)
    wipRoot = {
      dom: currentRoot.dom,
      props: currentRoot.props,
      alternate: currentRoot,
    }
    nextUnitOfWork = wipRoot
    deletions = []
  }

  wipFiber.hooks.push(hook)
  hookIndex++
  return [hook.state, setState]
}

// 更新普通组件fiber
function updateHostComponent(fiber) {
  if (!fiber.dom) {
    fiber.dom = createDom(fiber)
  }
  // 为每个子元素创建fiber
  reconcileChildren(fiber, fiber.props.children)
}

function reconcileChildren(wipFiber, elements) {
  console.log(wipFiber, elements)
  let index = 0
  // 找到前一次渲染时的第一个子fiber
  let oldFiber = wipFiber.alternate && wipFiber.alternate.child
  let prevSibling = null

  while (
    index < elements.length ||
    oldFiber != null // 保证把旧的子fiber也遍历完
  ) {
    const element = elements[index]
    let newFiber = null

    // 比较新旧fiber
    const sameType =
      oldFiber &&
      element &&
      element.type == oldFiber.type
    
    if (sameType) {
      // 更新节点
      newFiber = {
        type: oldFiber.type,
        props: element.props,
        dom: oldFiber.dom,
        parent: wipFiber,
        alternate: oldFiber,
        effectTag: 'UPDATE',
      }
    }
    if (element && !sameType) {
      // 新增节点
      newFiber = {
        type: element.type,
        props: element.props,
        dom: null,
        parent: wipFiber,
        alternate: null,
        effectTag: "PLACEMENT",
      }
    }
    if (oldFiber && !sameType) {
      // 删除节点
      oldFiber.effectTag = "DELETION"
      deletions.push(oldFiber)
    }

    // 如果当前遍历中存在oldFiber，将oldFiber向后递增一个兄弟fiber
    if (oldFiber) {
      oldFiber = oldFiber.sibling
    }

    if (index === 0) {
      // 对第一个子fiber，将父fiber的child指向它
      wipFiber.child = newFiber
    } else {
      // 非第一个子fiber，将前一个兄弟fiber的sibling指向它
      prevSibling.sibling = newFiber
    }

    prevSibling = newFiber
    index++
  }
}

const Didact = {
  createElement,
  render,
  useState,
}

// /** @jsx Didact.createElement */
// const element = (
//   <div id="foo" onClick={() => console.log('111')}>
//     <a>bar</a>
//     <b />
//   </div>
// )

// /** @jsx Didact.createElement */
// function App(props) {
//   return <h1>Hi {props.name}</h1>
// }
// const element = <App name="foo" />

/** @jsx Didact.createElement */
function Counter() {
  const [state, setState] = Didact.useState(1)
  return (
    <h1 onClick={() => setState(c => c + 1)}>
      Count: {state}
    </h1>
  )
}
const element = <Counter />
const container = document.getElementById('root')

Didact.render(element, container)

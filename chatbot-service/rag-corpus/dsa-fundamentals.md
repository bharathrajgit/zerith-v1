# DSA learning reference

## Arrays and index boundaries

An array stores values in indexed positions. An index-based loop should be
checked against the valid range from zero through length minus one. For an
empty array, the length is zero and no valid element index exists. Useful edge
cases include empty input, one element, duplicate values, and a target at
either boundary.

When reasoning about a two-pointer scan, write down what each pointer means
before moving it. Check whether a pointer can move beyond the array boundary,
whether both pointers can refer to the same element, and whether every move
makes progress toward termination.

## Complexity

Big O describes how resource usage grows as input size grows. A single pass
over n items is linear time, while nested loops over the same n items are
often quadratic. A hash-based lookup is commonly constant-time on average,
with additional memory proportional to the stored keys. To compare two
approaches, identify the dominant operation and state which input size it
depends on.

## Sorting and binary search

Binary search applies to data ordered by the searched comparison. Each
iteration should reduce the remaining candidate interval; carefully define
whether the right endpoint is inclusive or exclusive and use that convention
consistently. Consider empty input, one candidate, and a target outside the
range to check termination and boundary handling.

## Stacks and queues

A stack is last-in, first-out and is useful when the newest unresolved item
must be handled first. A queue is first-in, first-out and is useful when items
must be processed in arrival order. For either structure, test empty removal,
one item, and repeated insertions/removals.

## Linked structures

A linked list stores references between nodes rather than relying on adjacent
array positions. Before changing links, identify the previous node, current
node, and next node. Check empty lists, a single node, and changes at the head
or tail so that no reference to the rest of the list is lost.

## Debugging strategy

Use the smallest input that exercises the suspected branch. Trace the state
before and after one iteration, including indices, pointers, and collection
contents. Compare the actual state to the loop invariant or intended
relationship. Prefer asking which invariant changed unexpectedly over
guessing at a fix.

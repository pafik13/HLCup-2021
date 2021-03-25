#!/bin/bash

INDEX=89

while [ $INDEX -lt 150 ]
do
  REMAINDER=$(( $INDEX % 6 )) 
  if [ $REMAINDER -eq 0 ]

  then
    echo $INDEX
    docker build --build-arg GLOBAL_OFFSET_X=$INDEX --build-arg EXPLORE_SIZE=1 --build-arg EXPLORE_CONCURRENCY=10 --build-arg PRINT_DIGS_COUNT=200 --build-arg PRINT_STATS_TIME=600000 -t hlcup2021/ts .
    docker tag hlcup2021/ts:latest stor.highloadcup.ru/rally/tall_yak
    docker push stor.highloadcup.ru/rally/tall_yak

    SECOND=$(($INDEX+3))
    echo $SECOND
    docker build --build-arg GLOBAL_OFFSET_X=$SECOND --build-arg EXPLORE_SIZE=1 --build-arg EXPLORE_CONCURRENCY=10 --build-arg PRINT_DIGS_COUNT=200 --build-arg PRINT_STATS_TIME=600000 -t hlcup2021/ts .
    docker tag hlcup2021/ts:latest stor.highloadcup.ru/rally/invisible_owl
    docker push stor.highloadcup.ru/rally/invisible_owl

  fi
  
  INDEX=$(($INDEX+1))
done

docker system prune -f
